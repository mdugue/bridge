import {
  Color,
  DoubleSide,
  type Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
} from "three";
import { FENCE_CODE, FENCE_UV_CODES, FENCE_UV_SPAN } from "@/lib/city/fences";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/*
 * The fences' tones, from the street furniture's palette (furniture-layer.ts)
 * a step darker, so a railing reads as iron against the pale scene without
 * turning into ink: a deep slate for iron, the furniture's slate for wire,
 * its honey for wood, and a darker slate for a gate's frame and a boom.
 */
const IRON = 0x8e_8d_99;
const WIRE = 0xb4_b3_bf;
const WOOD = 0xcf_bc_a7;
const FRAME = 0x76_75_7f;
/** What an unresolved panel lightens toward (a veil, not a wall). */
const VEIL = 0xd9_d7_df;

/** Beyond this distance (m) a panel fades to its veil whatever it resolves. */
const FAR_START_M = 40;
const FAR_END_M = 60;

const glslVec3 = (hex: number) => {
  const c = new Color(hex); // linear, as the shader works
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/**
 * The panel patterns, box-filtered over the pixel footprint (fwidth) so a
 * bar never flickers between on and off. A panel runs from 5 cm below the
 * ground (v = 0) to the fence's top (v = 1); its post stands at its start
 * (x = 0) and its rail along the top — the frame — and between them the
 * infill: bars, a wire mesh, pickets, a gate's bars, or nothing (a handrail).
 * The UV packs the pattern code and the distance along the panel
 * (lib/city/fences.ts).
 */
const FENCE_PATTERN = /* glsl */ `
varying vec2 vFenceUv;
float fencePulse( float x, float p, float w, float fw ) {
  if ( fw < 1e-5 ) return step( abs( mod( x, p ) - 0.5 * p ), 0.5 * w );
  float x0 = x - 0.5 * fw;
  float x1 = x + 0.5 * fw;
  float g0 = floor( x0 / p ) * w + clamp( mod( x0, p ) - 0.5 * ( p - w ), 0.0, w );
  float g1 = floor( x1 / p ) * w + clamp( mod( x1, p ) - 0.5 * ( p - w ), 0.0, w );
  return clamp( ( g1 - g0 ) / fw, 0.0, 1.0 );
}
float fenceBand( float y, float a, float b, float fy ) {
  if ( fy < 1e-5 ) return step( a, y ) * step( y, b );
  return clamp( ( min( y + 0.5 * fy, b ) - max( y - 0.5 * fy, a ) ) / fy, 0.0, 1.0 );
}
// The post at the panel's start and the rail along its top.
float fenceFrame( float code, float x, float y ) {
  if ( code > ${(FENCE_CODE.handrail + 0.5).toFixed(1)} ) return 1.0;
  float post = abs( code - ${FENCE_CODE.picket.toFixed(1)} ) < 0.5 ? 0.075 : 0.045;
  return max( fenceBand( x, 0.0, post, fwidth( x ) ), fenceBand( y, 0.97, 1.01, fwidth( y ) ) );
}
// The infill: (coverage, unresolved, mean coverage).
vec3 fenceInfill( float code, float x, float y ) {
  float fx = fwidth( x );
  float fy = fwidth( y );
  float inside = fenceBand( y, 0.07, 0.97, fy );
  if ( code > ${(FENCE_CODE.handrail - 0.5).toFixed(1)} ) return vec3( 0.0 );
  if ( code < 0.5 ) { // railing: bars every 12.5 cm, a lower rail
    float c = max( fencePulse( x, 0.125, 0.02, fx ), fenceBand( y, 0.1, 0.14, fy ) );
    return vec3( c * inside, smoothstep( 1.0, 2.5, fx / 0.02 ), 0.2 );
  }
  if ( code < 1.5 ) { // mesh: a diamond lattice of wire
    float ym = y * 1.2;
    float d1 = x + ym;
    float d2 = x - ym;
    float c1 = fencePulse( d1, 0.07, 0.008, fwidth( d1 ) );
    float c2 = fencePulse( d2, 0.07, 0.008, fwidth( d2 ) );
    float c = 1.0 - ( 1.0 - c1 ) * ( 1.0 - c2 );
    return vec3( c * inside, smoothstep( 1.0, 2.5, fx / 0.008 ), 0.25 );
  }
  if ( code < 2.5 ) { // pickets: boards with two battens
    float battens = max( fenceBand( y, 0.2, 0.26, fy ), fenceBand( y, 0.74, 0.8, fy ) );
    float c = max( fencePulse( x, 0.12, 0.085, fx ), battens );
    return vec3( c * inside, smoothstep( 1.0, 2.5, fx / 0.035 ), 0.75 );
  }
  // a gate leaf: denser bars, a bottom and a middle bar
  float bars = max( fenceBand( y, 0.07, 0.12, fy ), fenceBand( y, 0.5, 0.55, fy ) );
  float c = max( fencePulse( x, 0.1, 0.02, fx ), bars );
  return vec3( c * inside, smoothstep( 1.0, 2.5, fx / 0.02 ), 0.3 );
}
// An ordered 4×4 threshold in screen (or shadow-map) pixels.
float fenceBayer( vec2 p ) {
  vec2 a = floor( p );
  vec2 h = floor( 0.5 * a );
  float b2a = fract( a.x * 0.5 + a.y * a.y * 0.75 );
  float b2h = fract( h.x * 0.5 + h.y * h.y * 0.75 );
  return b2h * 0.25 + b2a + 1.0 / 32.0;
}
void fenceDecode( out float code, out float x, out float y ) {
  float uu = vFenceUv.x * ${(FENCE_UV_CODES * FENCE_UV_SPAN).toFixed(1)};
  code = floor( uu / ${FENCE_UV_SPAN.toFixed(1)} );
  x = uu - code * ${FENCE_UV_SPAN.toFixed(1)};
  y = vFenceUv.y;
}
`;

const FENCE_COLOR = /* glsl */ `
vec3 fenceColor( float code ) {
  if ( abs( code - ${FENCE_CODE.gate.toFixed(1)} ) < 0.5 || abs( code - ${FENCE_CODE.frame.toFixed(1)} ) < 0.5 ) return ${glslVec3(FRAME)};
  if ( abs( code - ${FENCE_CODE.mesh.toFixed(1)} ) < 0.5 ) return ${glslVec3(WIRE)};
  if ( abs( code - ${FENCE_CODE.picket.toFixed(1)} ) < 0.5 || abs( code - ${FENCE_CODE.wood.toFixed(1)} ) < 0.5 ) return ${glslVec3(WOOD)};
  return ${glslVec3(IRON)};
}
`;

const VERTEX_UV = "#include <begin_vertex>\nvFenceUv = uv;";

/**
 * The colour pass: near, the frame and the infill cut out crisply (coverage
 * ≥ ½); where the infill's bars fall under a pixel, or beyond FAR_START_M,
 * the panel fades to a lighter veil of its mean coverage, dithered in screen
 * space — the plan's fallback against alpha-tested shimmer, taken up front
 * because no GPU was at hand to judge it.
 */
const FRAGMENT_CUT = `#include <map_fragment>
float fenceCode; float fenceX; float fenceY;
fenceDecode( fenceCode, fenceX, fenceY );
float fenceFr = fenceFrame( fenceCode, fenceX, fenceY );
vec3 fenceIn = fenceInfill( fenceCode, fenceX, fenceY );
float fenceFar = max( fenceIn.y, smoothstep( ${FAR_START_M.toFixed(1)}, ${FAR_END_M.toFixed(1)}, length( vViewPosition ) ) );
float fenceA = max( fenceFr, mix( fenceIn.x, fenceIn.z, fenceFar ) );
float fenceCut = mix( 0.5, fenceBayer( gl_FragCoord.xy ), fenceFar );
if ( fenceA < fenceCut ) discard;
vec3 fenceCol = fenceColor( fenceCode );
diffuseColor.rgb *= mix( fenceCol, ${glslVec3(VEIL)}, 0.5 * fenceFar * ( 1.0 - step( 0.5, fenceFr ) ) );`;

/**
 * The shadow pass: posts and rails cast in full; the infill the share of
 * shadow its bars cover — dithered per shadow-map texel, which the soft PCF
 * filter smooths into a light, partial shadow.
 */
const DEPTH_CUT = `#include <alphatest_fragment>
float fenceCode; float fenceX; float fenceY;
fenceDecode( fenceCode, fenceX, fenceY );
float fenceA = max( fenceFrame( fenceCode, fenceX, fenceY ), fenceInfill( fenceCode, fenceX, fenceY ).x );
if ( fenceA < fenceBayer( gl_FragCoord.xy ) ) discard;`;

function patchVertex(vertexShader: string): string {
  return vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec2 vFenceUv;")
    .replace("#include <begin_vertex>", VERTEX_UV);
}

/** The depth material the sun's shadow map renders the fences with. */
function fenceDepthMaterial(): MeshDepthMaterial {
  // As WebGLShadowMap's own depth material (no packing: the shadow map is a
  // depth texture), plus the cut-outs.
  const depth = new MeshDepthMaterial({ side: DoubleSide });
  depth.customProgramCacheKey = () => "fence-depth";
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = patchVertex(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${FENCE_PATTERN}`)
      .replace("#include <alphatest_fragment>", DEPTH_CUT);
  };
  return depth;
}

/**
 * Fences, railings and gates from OSM, baked with the terrain: the fine
 * terrain glTF carries a `fences` node (lib/city/fences.ts, written by
 * scripts/bake-tiles.ts `fenceMesh` on the final ground). This gives it its
 * material — the panel pattern drawn from the UV — and a depth material that
 * lets the panels cast a partial shadow. Neither is an alpha map: three
 * would copy a colour material's alphaMap and alphaTest onto any depth
 * material (WebGLShadowMap), so the cut-outs are discards in both shaders.
 * It arrives and leaves with its tile; the depth material goes with the
 * colour one.
 */
export function dressFences(mesh: Mesh, heightFog?: HeightFogUniforms): void {
  const material = new MeshStandardMaterial({
    color: 0xff_ff_ff,
    roughness: 0.7,
    metalness: 0,
    side: DoubleSide,
  });
  material.customProgramCacheKey = () => `fence-${heightFog !== undefined}`;
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = patchVertex(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${FENCE_PATTERN}\n${FENCE_COLOR}`
      )
      .replace("#include <map_fragment>", FRAGMENT_CUT);
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  const depth = fenceDepthMaterial();
  material.addEventListener("dispose", () => depth.dispose());
  mesh.material = material;
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
