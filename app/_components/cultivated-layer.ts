import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import {
  COLONY_AXIS_STEPS,
  COLONY_EDGE_SCALE,
  COLONY_GARDEN as G,
  VINE_ROW,
} from "@/lib/city/cultivated";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { srgbToLinear } from "@/lib/city/landcover";
import type { Point2 } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { hedgePieces } from "./low-vegetation-layer";
import { bucketByCell, hash } from "./vegetation-layer";

/**
 * Cultivated land (pipeline/bake/cultivated.py, lib/city/cultivated.ts,
 * plan 028):
 *
 * - **Allotment colonies** in the terrain's fragment pass: little gardens
 *   over the class colour. The colony's outline is the baked signed
 *   distance to its garden land (paths, roads and water cut out), sampled
 *   LINEAR and faded over a metre with a slow wobble — a soft, organic
 *   edge, never the raster's staircase. Inside, everything is analytic in
 *   the data frame: plots are the cells of a jittered Voronoi in the
 *   colony's axis frame (≈12 × 17 m), their borders meandering and drawn
 *   as thin soft paths; each plot is a lawn in one of a few soft greens,
 *   a third with warm vegetable beds, some with sparse pastel flower dots,
 *   the rest with darker shrub mottles, and a faint hedge green inside the
 *   colony's rim. Every line and band is box-filtered over the pixel
 *   footprint, and the detail fades with distance to the plots' tones and
 *   then to the colony's one calm tone, so nothing shimmers from the air.
 *   Scales with *Bodendetail*.
 * - **Orchards**: their trees join the street-tree cadastre as the "small"
 *   archetype (tile-stream.ts), so they ride in the tree layer's chunks.
 * - **Vineyards**: each row a chain of low boxes, 1.3 m tall and 0.5 m
 *   wide, in foliage green, chunked into 250 m cells like the hedges.
 */

const lin = (r: number, g: number, b: number) =>
  `vec3( ${[r, g, b].map((c) => srgbToLinear(c).toFixed(4)).join(", ")} )`;
const f = (v: number) => v.toFixed(3);

/** Declarations (after groundDetailDecl: needs gdHash, gdNoise). */
export const COLONY_DECL = /* glsl */ `
  uniform highp sampler2D uCultivated;
  // the raster's part of the tile (prepare-data crops it): origin, size (uv)
  uniform vec4 uCultivatedRect;
  // Coverage of |d| < hw over the footprint [d - w, d + w].
  float ctLine( float d, float hw, float w ) {
    return max( 0.0, min( d + w, hw ) - max( d - w, -hw ) ) / ( 2.0 * w );
  }
  // Coverage of bands [k p, k p + a) over [x - w, x + w], exactly.
  float ctCum( float t, float a, float p ) {
    float k = floor( t / p );
    return k * a + min( t - k * p, a );
  }
  float ctBands( float x, float a, float p, float w ) {
    return ( ctCum( x + w, a, p ) - ctCum( x - w, a, p ) ) / ( 2.0 * w );
  }
  vec2 ctSeed( vec2 c ) {
    vec2 j = vec2( gdHash( c ), gdHash( c + 17.3 ) ) - 0.5;
    return ( c + 0.5 + j * ${f(G.jitter)} ) * vec2( ${f(G.plotAlong)}, ${f(G.plotAcross)} );
  }
  // The plot at q (m, the colony's frame): its cell (xy) and the distance
  // (m) to its border (z) — a jittered Voronoi, the border exact.
  vec3 ctPlot( vec2 q ) {
    vec2 c0 = floor( q / vec2( ${f(G.plotAlong)}, ${f(G.plotAcross)} ) );
    float best = 1e9;
    vec2 bc = c0;
    vec2 bp = vec2( 0.0 );
    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        vec2 c = c0 + vec2( float( i ), float( j ) );
        vec2 p = ctSeed( c );
        float d = dot( q - p, q - p );
        if ( d < best ) {
          best = d;
          bc = c;
          bp = p;
        }
      }
    }
    float edge = 1e9;
    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        if ( i == 0 && j == 0 ) continue;
        vec2 p = ctSeed( bc + vec2( float( i ), float( j ) ) );
        edge = min( edge, dot( 0.5 * ( bp + p ) - q, normalize( p - bp ) ) );
      }
    }
    return vec3( bc, edge );
  }
`;

/** The gardens (after GROUND_DETAIL; needs the ground fields in scope). */
export const COLONY_GARDEN_GLSL = /* glsl */ `
  {
    vec2 ctUv = ( vSplatUv - uCultivatedRect.xy ) / uCultivatedRect.zw;
    if ( uGroundDetail > 0.0 && all( greaterThan( ctUv, vec2( 0.0 ) ) ) && all( lessThan( ctUv, vec2( 1.0 ) ) ) ) {
      float ctR = texture( uCultivated, ctUv ).r * 255.0;
      // metres inside the garden land's edge (0: farther outside than held)
      float ctD = ctR > 0.5 ? ( ctR - 128.0 ) / ${f(COLONY_EDGE_SCALE)} : -10.0;
      float ctW = max( gdW, 0.01 );
      // a soft edge that wanders a little, as hedges and fences do
      float ctEdge = ctD + ( gdNoise( vWorldXY * 0.35 ) - 0.5 ) * 0.8;
      float ctIn = smoothstep( -0.3 - ctW, 0.5 + ctW, ctEdge );
      if ( ctIn > 0.0 ) {
        ivec2 ctS = textureSize( uCultivated, 0 );
        float ctCode = floor( texelFetch( uCultivated, clamp( ivec2( ctUv * vec2( ctS ) ), ivec2( 0 ), ctS - 1 ), 0 ).g * 255.0 + 0.5 );
        float ctAxis = max( ctCode - 1.0, 0.0 ) / ${f(COLONY_AXIS_STEPS)} * PI;
        vec2 ctU = vec2( cos( ctAxis ), sin( ctAxis ) );
        vec2 ctQ = vec2( dot( vWorldXY, ctU ), dot( vWorldXY, vec2( -ctU.y, ctU.x ) ) );
        // the plot borders meander instead of running ruled
        ctQ += ( vec2( gdNoise( vWorldXY * 0.09 ), gdNoise( vWorldXY * 0.09 + 5.2 ) ) - 0.5 ) * ${f(G.warp)};
        vec3 ctP = ctPlot( ctQ );
        float ctH = gdHash( ctP.xy + 3.7 );
        float ctH2 = gdHash( ctP.xy + 11.9 );
        float ctNear = 1.0 - smoothstep( 0.04, 0.2, grFw ); // flowers
        float ctMid = 1.0 - smoothstep( 0.6, 2.5, grFw );  // plots, paths, beds
        // one of a few soft greens per plot; from afar the colony's one tone
        vec3 ctGreen = ctH2 < 0.3 ? mix( uMeadowColor, ${lin(160, 186, 140)}, 0.5 )
          : ctH2 < 0.6 ? mix( uMeadowColor, ${lin(175, 195, 158)}, 0.6 )
          : ctH2 < 0.85 ? mix( uMeadowColor, ${lin(210, 211, 160)}, 0.5 )
          : uMeadowColor;
        vec3 ctCol = mix( mix( uMeadowColor, ${lin(175, 195, 158)}, 0.4 ), ctGreen, ctMid );
        // clear of the path between the plots
        float ctInner = smoothstep( 0.8, 1.5, ctP.z ) * ctMid;
        if ( ctH < 0.34 ) {
          // vegetable beds: warm soil rows between green ones, in a patch
          float ctRows = gdHash( ctP.xy + 23.1 ) > 0.5 ? ctQ.x : ctQ.y;
          float ctSoil = ctBands( ctRows, ${f(G.bedWidth * 0.55)}, ${f(G.bedWidth)}, ctW );
          float ctPatch = smoothstep( 0.3, 0.5, gdNoise( ctQ * 0.16 + ctP.xy * 3.1 ) );
          ctCol = mix( ctCol, mix( ctGreen * 0.95, ${lin(200, 176, 146)}, ctSoil ), ctInner * ctPatch * 0.85 );
        } else if ( ctH < 0.6 ) {
          // flowers: sparse pastel dots on a jittered grid, a faint blush afar
          vec2 ctF = ctQ / ${f(G.flowerSpacing)};
          vec2 ctFc = floor( ctF );
          float ctFh = gdHash( ctFc + ctP.xy * 1.7 );
          vec2 ctFo = ( vec2( gdHash( ctFc + 5.1 ), gdHash( ctFc + 9.7 ) ) - 0.5 ) * 0.6;
          float ctFd = length( ( fract( ctF ) - 0.5 - ctFo ) * ${f(G.flowerSpacing)} );
          float ctDot = ( 1.0 - smoothstep( ${f(G.flowerRadius)} - ctW, ${f(G.flowerRadius)} + ctW, ctFd ) ) * step( 0.6, ctFh );
          vec3 ctFlower = ctFh < 0.75 ? ${lin(228, 180, 184)} : ctFh < 0.9 ? ${lin(238, 218, 164)} : ${lin(198, 186, 218)};
          ctCol = mix( ctCol, ctFlower, ctDot * ctInner * ctNear * 0.8 );
          ctCol = mix( ctCol, ${lin(228, 180, 184)}, 0.05 * ctMid );
        } else {
          // shrubs and fruit bushes: soft darker mottles
          float ctM = smoothstep( 0.55, 0.8, gdNoise( ctQ * 0.55 + ctP.xy * 7.3 ) );
          ctCol = mix( ctCol, ctGreen * 0.86, ctM * ctInner * 0.7 );
        }
        // thin soft paths between the plots, a trodden lawn's colour
        float ctPath = ctLine( ctP.z, ${f(G.pathHalfWidth)}, ctW );
        ctCol = mix( ctCol, ${lin(216, 210, 172)}, ctPath * ctMid * 0.75 );
        // a faint hedge green just inside the colony's rim
        float ctHedge = ctLine( ctEdge - 1.1, 0.5, ctW ) * ctMid;
        ctCol = mix( ctCol, ${lin(150, 176, 138)}, ctHedge * 0.3 );
        float ctOn = min( uGroundDetail / 0.7, 1.0 ) * ${f(G.strength)};
        baseCol = mix( baseCol, ctCol, ctIn * ctOn );
      }
    }
  }
`;

// --- vineyards --------------------------------------------------------------------

/** vine boxes are sunk this far so the terrain's facets never show a gap */
const SINK_M = 0.2;
const OVERLAP_M = 0.3;

interface VineInstance {
  len: number;
  rot: number;
  tint: number;
  x: number;
  y: number;
  z: number;
}

/** A tile's vine rows as box instances in the Y-up frame, stood on the
 *  ground. Pure but for the height sampler; exported for tests. */
export function vineInstances(
  rows: Point2[][],
  ctx: GroundContext
): VineInstance[] {
  const out: VineInstance[] = [];
  for (const row of rows) {
    for (const piece of hedgePieces(row, VINE_ROW.h, VINE_ROW.w)) {
      const ground = ctx.heightAt(piece.x, piece.y);
      if (ground === null) {
        continue;
      }
      const world = epsgToWorld(piece.x, piece.y, ctx.offset);
      out.push({
        x: world.x,
        y: ground - SINK_M,
        z: world.z,
        rot: piece.angle,
        len: piece.len + OVERLAP_M,
        tint: hash(piece.x * 0.31 + piece.y * 0.17) - 0.5,
      });
    }
  }
  return out;
}

function vineMaterial(heightFog?: HeightFogUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xff_ff_ff,
    roughness: 0.95,
  });
  if (heightFog) {
    material.customProgramCacheKey = () => "vine-fog";
    material.onBeforeCompile = (shader) => injectHeightFog(shader, heightFog);
  }
  return material;
}

export interface VineyardContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

/**
 * One tile's vine rows onto a Y-up group (add it to the tile's content
 * root). Empty input → an empty group; freed with the scene
 * (disposeObject3D).
 */
export function buildVineyards(rows: Point2[][], ctx: VineyardContext): Group {
  const group = new Group();
  group.name = "vineyards";
  const items = vineInstances(rows, ctx);
  if (items.length === 0) {
    return group;
  }
  const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = vineMaterial(ctx.heightFog);
  const dummy = new Object3D();
  const col = new Color();
  for (const cell of bucketByCell(items)) {
    const mesh = new InstancedMesh(geo, mat, cell.length);
    mesh.name = "vine-rows";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cell.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.len, VINE_ROW.h + SINK_M, VINE_ROW.w);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.25 + p.tint * 0.03, 0.36, 0.42 + p.tint * 0.06);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
