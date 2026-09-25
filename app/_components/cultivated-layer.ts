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
  COLONY_BEDS,
  PARCEL_BASE,
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
 * - **Allotment colonies** in the terrain's fragment pass: small beds,
 *   1.2 m strips of soil and green, in plots of ≈12 m — the cells of a
 *   jittered Voronoi, each turned along the colony's long axis or across
 *   it, with a dark green line where two plots meet — over the class
 *   colour, faded with distance like the paving. A mapped parcel takes its
 *   own axis and a lawn edge along its border. Kept faint (`COLONY_BEDS.
 *   strength`): none of the four tiles' 66 colonies maps its parcels, so
 *   the plots are a texture, not data. Scales with *Bodendetail*.
 * - **Orchards**: their trees join the street-tree cadastre as the "small"
 *   archetype (tile-stream.ts), so they ride in the tree layer's chunks.
 * - **Vineyards**: each row a chain of low boxes, 1.3 m tall and 0.5 m
 *   wide, in foliage green, chunked into 250 m cells like the hedges.
 */

const lin = (r: number, g: number, b: number) =>
  `vec3( ${[r, g, b].map((c) => srgbToLinear(c).toFixed(4)).join(", ")} )`;

/** Declarations (after groundDetailDecl: needs gdHash, gdW). */
export const COLONY_DECL = /* glsl */ `
  uniform highp sampler2D uCultivated;
`;

/** The beds (after GROUND_DETAIL; needs the ground fields in scope). */
export const COLONY_BEDS_GLSL = /* glsl */ `
  {
    ivec2 ctS = textureSize( uCultivated, 0 );
    vec2 ctT = floor( texelFetch( uCultivated, clamp( ivec2( vSplatUv * vec2( ctS ) ), ivec2( 0 ), ctS - 1 ), 0 ).rg * 255.0 + 0.5 );
    if ( ctT.x > 0.5 && uGroundDetail > 0.0 && grFw < 1.0 ) {
      bool ctParcel = ctT.x >= ${PARCEL_BASE.toFixed(1)};
      float ctAxis = ( ctParcel ? ctT.x - ${PARCEL_BASE.toFixed(1)} : ctT.x - 1.0 ) / ${COLONY_AXIS_STEPS.toFixed(1)} * PI;
      vec2 ctU = vec2( cos( ctAxis ), sin( ctAxis ) );
      vec2 ctQ = vec2( dot( vWorldXY, ctU ), dot( vWorldXY, vec2( -ctU.y, ctU.x ) ) );
      // plots: the cells of a jittered Voronoi (irregular, not a chessboard)
      float ctPlot = ${COLONY_BEDS.plot.toFixed(1)};
      vec2 ctCell = floor( ctQ / ctPlot );
      float ctD1 = 1e9;
      float ctD2 = 1e9;
      vec2 ctId = ctCell;
      for ( int j = -1; j <= 1; j++ ) {
        for ( int i = -1; i <= 1; i++ ) {
          vec2 c = ctCell + vec2( float( i ), float( j ) );
          vec2 jit = vec2( gdHash( c ), gdHash( c + 17.3 ) ) - 0.5;
          float d = length( ctQ - ( c + 0.5 + jit * ${COLONY_BEDS.plotJitter.toFixed(2)} ) * ctPlot );
          if ( d < ctD1 ) {
            ctD2 = ctD1;
            ctD1 = d;
            ctId = c;
          } else if ( d < ctD2 ) {
            ctD2 = d;
          }
        }
      }
      float ctH = gdHash( ctId + 3.7 );
      // beds along the colony's axis or across it, per plot
      float ctS1 = ctH > 0.5 ? ctQ.y : ctQ.x;
      float ctBed = ${COLONY_BEDS.bedWidth.toFixed(2)};
      float ctK = floor( ctS1 / ctBed );
      float ctHb = gdHash( vec2( ctK, ctId.x * 7.0 + ctId.y * 13.0 ) );
      vec3 ctSoil = ${lin(170, 146, 120)};
      vec3 ctVeg = ${lin(146, 176, 118)};
      vec3 ctCol = ctHb < 0.35 ? ctSoil : ( ctHb < 0.75 ? ctVeg : uMeadowColor );
      // a trodden strip between the beds
      float ctE = abs( fract( ctS1 / ctBed ) - 0.5 ) * ctBed;
      float ctGap = smoothstep( ctBed * 0.5 - 0.14 - gdW, ctBed * 0.5 - 0.14 + gdW, ctE );
      ctCol = mix( ctCol, ctSoil * 0.92, ctGap * 0.6 );
      // from afar only the plot's tone
      float ctNear = 1.0 - smoothstep( 0.08, 0.3, grFw );
      vec3 ctPlotCol = mix( uMeadowColor, ctVeg, 0.35 + 0.3 * ctH );
      ctCol = mix( ctPlotCol, ctCol, ctNear );
      // where two plots meet, a dark green line (a hedge, a fence's grass)
      float ctEdge = 1.0 - smoothstep( 0.25 - gdW, 0.25 + gdW, 0.5 * ( ctD2 - ctD1 ) );
      ctCol = mix( ctCol, uMeadowColor * 0.72, ctEdge * 0.7 * ( 1.0 - smoothstep( 0.15, 0.6, grFw ) ) );
      if ( ctParcel ) {
        float ctLawn = 1.0 - smoothstep( 0.2 - gdW, 0.2 + gdW, ctT.y / 20.0 );
        ctCol = mix( ctCol, uMeadowColor * 0.8, ctLawn );
      }
      float ctOn = min( uGroundDetail / 0.7, 1.0 ) * ${COLONY_BEDS.strength.toFixed(2)};
      baseCol = mix( baseCol, ctCol, ctOn * ( 1.0 - smoothstep( 0.6, 1.0, grFw ) ) );
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
