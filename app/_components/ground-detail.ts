import {
  BUILTUP_CLASS,
  MEADOW_CLASS,
  PATH_CLASS,
  ROAD_CLASS,
  type SurfaceKind,
  surfaceId,
} from "@/lib/city/landcover";

/**
 * Ground detail in the terrain's fragment pass — zero geometry, like the
 * meadow mottle it sits next to (terrain-layer.ts). Four things:
 *
 * - **Kerbs.** The carriageway (class 7) is a buffer of the DLM road axis by
 *   its surveyed width, so its edge IS the kerb line. The four class texels
 *   around the fragment, read as 0/1 road indicators and interpolated
 *   bilinearly, give a smooth field whose 0.5 isoline runs along that edge;
 *   dividing by the field's gradient turns it into a signed distance in
 *   metres. A pale kerb stone on the pavement side, a darker gutter on the
 *   road side and a shading-normal step at the face make it read as a raised
 *   edge — only where the other side is ground a kerb borders (not water,
 *   not the railway).
 * - **Lawn edges.** The same distance for the meadow class: a slightly
 *   darker lip and a normal kink where the grass meets a path.
 * - **Paving.** The OSM paving raster (pipeline/bake/surface.py; optional)
 *   says which material a street or walkway is made of and which way it
 *   runs, so sett rows and slabs lie along the street. Without it the class
 *   picks: asphalt on the road, slabs on the pavement, a sanded path.
 *   Joints and stones fade out by `fwidth` long before they could alias; the
 *   material's colour cue stays at any distance.
 * - **Urban green** (with the NDVI raster). The DLM's built-up class covers
 *   courtyards, front gardens and parks alike; where the DOP says it is
 *   green (and it is neither road nor a surface OSM calls sealed) the ground
 *   takes the meadow colour.
 *
 * All strengths scale with the look rows `groundDetail` and `urbanGreen`.
 * Everything here reads NEAREST rasters through `texelFetch`, so no implicit
 * derivative is taken in non-uniform control flow.
 */

const id = (kind: SurfaceKind) => String(surfaceId(kind));

/** Declarations after `#include <common>` (needs `uSplatClass` declared). */
export function groundDetailDecl(hasSurface: boolean): string {
  return /* glsl */ `
  uniform vec2 uSplatSize;
  uniform float uGroundDetail;
  uniform vec3 uMeadowColor;
  ${hasSurface ? "uniform highp sampler2D uSurface;" : ""}
  int gdClassAt( ivec2 p ) {
    ivec2 s = textureSize( uSplatClass, 0 );
    return int( texelFetch( uSplatClass, clamp( p, ivec2( 0 ), s - 1 ), 0 ).r * 255.0 + 0.5 );
  }
  // ground a kerb borders: background, meadow, forest, copse, built-up, path
  float gdKerbable( int c ) { return ( c <= ${BUILTUP_CLASS} || c == ${PATH_CLASS} ) ? 1.0 : 0.0; }
  // A data-frame horizontal direction in view space (world = data (x, z, -y)).
  vec3 gdToView( vec2 d ) { return ( viewMatrix * vec4( d.x, 0.0, -d.y, 0.0 ) ).xyz; }
  // Hash without sin (stable at large coordinates), Dave Hoskins' hash12.
  float gdHash( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }
  float gdNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( gdHash( i ), gdHash( i + vec2( 1.0, 0.0 ) ), f.x ),
                mix( gdHash( i + vec2( 0.0, 1.0 ) ), gdHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  // Bilinear 0/1 field (x) and its gradient per metre in the data frame (yz).
  // Texel rows grow southward, so the data-y gradient is the negated row one.
  vec3 gdField( vec4 c, vec2 f, vec2 mpt ) {
    float v = mix( mix( c.x, c.y, f.x ), mix( c.z, c.w, f.x ), f.y );
    float gu = mix( c.y - c.x, c.w - c.z, f.y ) / mpt.x;
    float gv = mix( c.z - c.x, c.w - c.y, f.x ) / mpt.y;
    return vec3( v, gu, -gv );
  }
  // The same field over a 4×4 texel block, each corner the 3×3 mean around
  // it before the bilinear step: a box-smoothed class edge, whose isoline
  // runs straight along a diagonal instead of following the raster's
  // staircase. 16 fetches, so only near the camera. x = road, y = lawn.
  void gdSmooth( ivec2 i, vec2 f, vec2 mpt, out vec3 road, out vec3 lawn ) {
    float r[16];
    float m[16];
    for ( int y = 0; y < 4; y++ ) {
      for ( int x = 0; x < 4; x++ ) {
        int c = gdClassAt( i + ivec2( x - 1, y - 1 ) );
        r[ y * 4 + x ] = c == ${ROAD_CLASS} ? 1.0 : 0.0;
        m[ y * 4 + x ] = c == ${MEADOW_CLASS} ? 1.0 : 0.0;
      }
    }
    vec4 rc = vec4( 0.0 );
    vec4 mc = vec4( 0.0 );
    for ( int k = 0; k < 4; k++ ) {
      int cx = 1 + ( k & 1 );
      int cy = 1 + ( k >> 1 );
      float rs = 0.0;
      float ms = 0.0;
      for ( int dy = -1; dy <= 1; dy++ ) {
        for ( int dx = -1; dx <= 1; dx++ ) {
          rs += r[ ( cy + dy ) * 4 + cx + dx ];
          ms += m[ ( cy + dy ) * 4 + cx + dx ];
        }
      }
      rc[ k ] = rs / 9.0;
      mc[ k ] = ms / 9.0;
    }
    road = gdField( rc, f, mpt );
    lawn = gdField( mc, f, mpt );
  }
  // Signed distance (m) to the field's 0.5 isoline, positive inside.
  float gdSd( vec3 fld ) {
    float g = length( fld.yz );
    return g > 1e-4 ? ( fld.x - 0.5 ) / g : ( fld.x > 0.5 ? 1e3 : -1e3 );
  }
  // 1 inside [a, b] (m), anti-aliased over w on either edge.
  float gdBand( float d, float a, float b, float w ) {
    return smoothstep( a - w, a + w, d ) - smoothstep( b - w, b + w, d );
  }
  // 1 on a joint of a (size.x × size.y) grid, joint width jw (m).
  float gdJoint( vec2 q, vec2 size, float jw, float w ) {
    // cells are centred on whole multiples of size, so joints sit halfway
    vec2 e = abs( fract( q / size ) - 0.5 ) * size;
    float m = min( e.x, e.y );
    return 1.0 - smoothstep( jw * 0.5 - w, jw * 0.5 + w, m );
  }
`;
}

/**
 * The fields every later chunk reads: the road and lawn distances, the
 * paving kind and the street direction. After GRASS_MOTTLE (`grCls`, `grFw`).
 */
export function groundFields(hasSurface: boolean): string {
  const surface = hasSurface
    ? /* glsl */ `
    ivec2 gdSs = textureSize( uSurface, 0 );
    vec2 gdS = texelFetch( uSurface, clamp( ivec2( vSplatUv * vec2( gdSs ) ), ivec2( 0 ), gdSs - 1 ), 0 ).rg;
    int gdByte = int( gdS.r * 255.0 + 0.5 );
    gdRoadKind = gdByte & 7;
    gdWalkKind = gdByte >> 3;
    float gdG = floor( gdS.g * 255.0 + 0.5 );
    gdHead = gdG > 0.5 ? ( gdG - 1.0 ) / 254.0 * PI : 0.0;`
    : "";
  return /* glsl */ `
  vec2 gdTexels = vec2( textureSize( uSplatClass, 0 ) );
  vec2 gdMpt = uSplatSize / gdTexels;
  vec2 gdP = vSplatUv * gdTexels - 0.5;
  ivec2 gdI = ivec2( floor( gdP ) );
  vec2 gdF = gdP - floor( gdP );
  int gdC00 = gdClassAt( gdI );
  int gdC10 = gdClassAt( gdI + ivec2( 1, 0 ) );
  int gdC01 = gdClassAt( gdI + ivec2( 0, 1 ) );
  int gdC11 = gdClassAt( gdI + ivec2( 1, 1 ) );
  vec3 gdRoad = gdField( vec4( gdC00 == ${ROAD_CLASS}, gdC10 == ${ROAD_CLASS}, gdC01 == ${ROAD_CLASS}, gdC11 == ${ROAD_CLASS} ), gdF, gdMpt );
  vec3 gdLawn = gdField( vec4( gdC00 == ${MEADOW_CLASS}, gdC10 == ${MEADOW_CLASS}, gdC01 == ${MEADOW_CLASS}, gdC11 == ${MEADOW_CLASS} ), gdF, gdMpt );
  // Near the camera, the smoothed edges for the kerb and the lawn lip (the
  // cheap fields above still decide road or not, so the paving boundary and
  // the kerb agree to within a fraction of a texel).
  vec3 gdRoadEdge = gdRoad;
  vec3 gdLawnEdge = gdLawn;
  if ( grFw < 0.5 && uGroundDetail > 0.0 ) {
    gdSmooth( gdI, gdF, gdMpt, gdRoadEdge, gdLawnEdge );
  }
  float gdKerbOk = gdField( vec4( gdKerbable( gdC00 ), gdKerbable( gdC10 ), gdKerbable( gdC01 ), gdKerbable( gdC11 ) ), gdF, gdMpt ).x;
  int gdRoadKind = 0;
  int gdWalkKind = 0;
  float gdHead = 0.0;
  ${surface}
  int gdCls = int( grCls );
  bool gdOnRoad = gdRoadEdge.x > 0.5;
  int gdKind = 0;
  if ( gdOnRoad ) {
    gdKind = gdRoadKind > 0 ? gdRoadKind : ${id("asphalt")};
  } else if ( gdCls == ${BUILTUP_CLASS} ) {
    gdKind = gdWalkKind > 0 ? gdWalkKind : ${id("paving")};
  } else if ( gdCls == ${PATH_CLASS} ) {
    gdKind = gdWalkKind > 0 ? gdWalkKind : ${id("unpaved")};
  } else if ( gdCls == 0 ) {
    gdKind = gdWalkKind;
  }
  // AA half-width (m per pixel) and the three distance fades.
  float gdW = max( grFw, 0.002 );
  float gdNear = 1.0 - smoothstep( 0.12, 0.5, grFw );   // kerbs, lawn edges
  float gdMid = 1.0 - smoothstep( 0.05, 0.35, grFw );   // mottles
  float gdFine = 1.0 - smoothstep( 0.012, 0.05, grFw ); // stones, joints
  vec3 gdTilt = vec3( 0.0 );
`;
}

/**
 * Urban green: NDVI on built-up/background ground that is neither road nor
 * sealed by OSM's account. Defines `ugW` (the green weight) either way.
 */
export function urbanGreen(hasNdvi: boolean): string {
  if (!hasNdvi) {
    return "float ugW = 0.0;";
  }
  return /* glsl */ `
  // One mip coarser: the ~2 m NDVI read as a soft field, not a speckle.
  float ugN = texture2D( uNdvi, vSplatUv, 1.0 ).r;
  float ugBuilt = ( gdCls == ${BUILTUP_CLASS} || gdCls == 0 ) ? 1.0 : 0.0;
  float ugSealed = ( gdWalkKind > 0 && gdWalkKind <= ${id("sett")} ) ? 1.0 : 0.0;
  float ugW = smoothstep( 0.22, 0.40, ugN ) * ugBuilt * ( 1.0 - ugSealed )
            * ( 1.0 - smoothstep( 0.3, 0.5, gdRoad.x ) ) * uUrbanGreen * 0.85;
  vec3 ugCol = mix( uMeadowColor, uMeadowColor * vec3( 0.84, 1.06, 0.74 ), smoothstep( 0.4, 0.7, ugN ) );
  baseCol = mix( baseCol, ugCol * ( 1.0 + grMottle * 0.06 ), ugW );
`;
}

/** Kerbs, lawn edges and the paving patterns (after `urbanGreen`). */
export const GROUND_DETAIL = /* glsl */ `
  {
    float gdOn = uGroundDetail;
    // --- kerb: stone on the pavement side, gutter on the road side ---
    float gdDr = gdSd( gdRoadEdge );
    float gdKerb = smoothstep( 0.15, 0.35, gdKerbOk ) * gdNear * gdOn;
    float gdTop = gdBand( gdDr, -0.30, 0.0, gdW );
    float gdGutter = gdBand( gdDr, 0.0, 0.35, gdW );
    float gdFace = gdBand( gdDr, -0.03, 0.05, max( gdW, 0.025 ) );
    baseCol = mix( baseCol, max( baseCol * 1.08, vec3( 0.78, 0.76, 0.72 ) ), gdTop * gdKerb * 0.8 );
    baseCol *= 1.0 - gdGutter * gdKerb * 0.14 - gdBand( gdDr, 0.0, 0.08, gdW ) * gdKerb * 0.08;
    vec2 gdIntoRoad = normalize( gdRoadEdge.yz + vec2( 1e-6 ) );
    gdTilt += gdToView( gdIntoRoad ) * gdFace * gdKerb * 0.9;

    // --- lawn edge: a darker lip and a kink where the grass stops ---
    float gdDl = gdSd( gdLawnEdge );
    float gdLip = gdBand( gdDl, 0.0, 0.25, gdW ) * gdNear * gdOn;
    baseCol *= 1.0 - gdLip * 0.12;
    vec2 gdOutOfLawn = -normalize( gdLawnEdge.yz + vec2( 1e-6 ) );
    gdTilt += gdToView( gdOutOfLawn ) * gdBand( gdDl, -0.02, 0.1, max( gdW, 0.025 ) ) * gdNear * gdOn * 0.5;

    // --- paving: along the street (q.x) and across it (q.y) ---
    vec2 gdAlong = vec2( cos( gdHead ), sin( gdHead ) );
    vec2 gdAcross = vec2( -gdAlong.y, gdAlong.x );
    vec2 gdQ = vec2( dot( vWorldXY, gdAlong ), dot( vWorldXY, gdAcross ) );
    float gdPave = gdOn * ( 1.0 - ugW );
    if ( gdKind == ${id("asphalt")} ) {
      float n = gdNoise( vWorldXY * 1.7 ) * 0.6 + gdNoise( vWorldXY * 0.31 ) * 0.4;
      baseCol *= ( 1.0 - 0.03 * gdPave ) * ( 1.0 + ( n - 0.5 ) * 0.08 * gdMid * gdPave );
    } else if ( gdKind == ${id("concrete")} ) {
      vec2 size = vec2( 4.0, 3.0 );
      float j = gdJoint( gdQ, size, 0.015, gdW );
      float h = gdHash( floor( gdQ / size + 0.5 ) );
      baseCol *= ( 1.0 + 0.03 * gdPave ) * ( 1.0 + ( h - 0.5 ) * 0.05 * gdMid * gdPave )
               * ( 1.0 - j * 0.14 * gdFine * gdPave );
    } else if ( gdKind == ${id("paving")} ) {
      vec2 size = vec2( 0.5, 0.35 );
      float row = floor( gdQ.y / size.y + 0.5 );
      vec2 q = gdQ + vec2( fract( row * 0.5 ) * size.x, 0.0 ); // running bond
      float j = gdJoint( q, size, 0.01, gdW );
      float h = gdHash( floor( q / size + 0.5 ) );
      baseCol *= ( 1.0 + ( h - 0.5 ) * 0.07 * gdFine * gdPave ) * ( 1.0 - j * 0.16 * gdFine * gdPave );
    } else if ( gdKind == ${id("sett")} ) {
      // Rows across the street, stones in running bond within each row.
      vec2 size = vec2( 0.15, 0.13 );
      float row = floor( gdQ.x / size.x + 0.5 );
      vec2 q = gdQ + vec2( 0.0, fract( row * 0.5 ) * size.y );
      vec2 cell = floor( q / size + 0.5 );
      vec2 uv = q / size - cell; // -0.5..0.5 inside a stone
      float h = gdHash( cell );
      float edge = smoothstep( 0.30, 0.5, max( abs( uv.x ), abs( uv.y ) ) );
      baseCol *= ( 1.0 - 0.07 * gdPave ) * vec3( 1.0, 0.985, 0.975 )
               * ( 1.0 + ( h - 0.5 ) * 0.14 * gdFine * gdPave ) * ( 1.0 - edge * 0.22 * gdFine * gdPave );
      // Pillow-shaped stones: the normal leans out from each stone's centre.
      gdTilt += gdToView( gdAlong * uv.x + gdAcross * uv.y ) * 0.7 * gdFine * gdPave;
    } else if ( gdKind == ${id("unpaved")} ) {
      float n = gdNoise( vWorldXY * 3.1 ) * 0.5 + gdNoise( vWorldXY * 0.7 ) * 0.5;
      baseCol *= mix( vec3( 1.0 ), vec3( 1.03, 1.0, 0.92 ), gdPave )
               * ( 1.0 + ( n - 0.5 ) * 0.10 * gdMid * gdPave );
    } else if ( gdKind == ${id("grass")} ) {
      vec2 size = vec2( 0.4 );
      vec2 uv = abs( gdQ / size - floor( gdQ / size + 0.5 ) );
      float hole = 1.0 - smoothstep( 0.28, 0.32, max( uv.x, uv.y ) );
      float green = mix( 0.3, hole * 0.8, gdFine );
      baseCol = mix( baseCol, uMeadowColor, green * gdPave );
    }
  }
`;

/** Folds the accumulated normal tilt in (after the meadow's normal). */
export const GROUND_NORMAL = /* glsl */ `
  normal = normalize( normal + gdTilt );
`;
