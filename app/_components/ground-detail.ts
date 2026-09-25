import {
  BUILTUP_CLASS,
  MEADOW_CLASS,
  PATH_CLASS,
  ROAD_CLASS,
  parkingId,
  EDGE_SCALE,
  SURFACE_ALONG_PERIOD,
  type SurfaceKind,
  surfaceId,
} from "@/lib/city/landcover";
import { KERB_HEIGHT } from "@/lib/city/kerbs";

/**
 * Ground detail in the terrain's fragment pass, next to the meadow mottle
 * (terrain-layer.ts). Five things:
 *
 * - **Kerb band.** The carriageway (class 7) is the DLM road axis buffered
 *   by its surveyed width, so its edge IS the kerb line. The distance to it
 *   comes from the baked edge raster (pipeline/bake/edges.py: smoothed,
 *   signed, valid out to ±6 m); without it, from the class texels around
 *   the fragment, box-smoothed (valid within a texel of the edge). A pale
 *   stone band on the pavement side and a darker gutter on the road side —
 *   where the other side is ground a kerb borders. On the fine level a real
 *   kerb stone stands on the band (lib/city/kerbs.ts, kerb-layer.ts); the
 *   band carries the line into the coarse level.
 * - **Lawn edges.** The same distance for the meadow (urban green
 *   included): a darker lip and a normal kink where the grass stops.
 * - **Paving.** The OSM paving raster (pipeline/bake/surface.py; optional)
 *   says which material a street or walkway is made of and gives the
 *   street's frame — the distance along the way and, near a road, the kerb
 *   distance across it — so slabs and sett rows follow the street through
 *   its bends. Without it the class picks: asphalt on the road, slabs on the
 *   pavement, a sanded path. Joints and stones fade out by `fwidth` long
 *   before they could alias; the material's colour cue stays at any
 *   distance, and sealed ground off the road takes the road's grey.
 * - **Parking.** The same raster marks parking lanes beside the carriageway
 *   (parallel or perpendicular bays, laid out from the kerb along the
 *   street) and car parks (bay lines across their aisle, the aisles left
 *   clear). Painted lines, faded out by distance.
 * - **Urban green.** Green courtyards, front gardens and parks inside the
 *   DLM's built-up class are painted exactly as meadow.
 *
 * All strengths scale with the look rows `groundDetail` and `urbanGreen`.
 * The class and paving rasters are read with `texelFetch`, the edge raster
 * with `textureLod`, so no implicit derivative is taken in non-uniform
 * control flow.
 */

const id = (kind: SurfaceKind) => String(surfaceId(kind));

// Every pattern length along a street below divides SURFACE_ALONG_PERIOD —
// bays 2.5 and 5.5 m, slabs 0.5, sett 0.15, concrete plates 5.5, grass
// pavers 0.55 — so the wrap of the baked coordinate never shows.
const ALONG_PERIOD = SURFACE_ALONG_PERIOD;

/** Declarations after `#include <common>` (needs `uSplatClass` declared). */
export function groundDetailDecl(
  hasSurface: boolean,
  hasEdges: boolean
): string {
  const edges = hasEdges
    ? /* glsl */ `
  uniform sampler2D uEdges;
  // Signed distances (m) to the road and the meadow edge (edges.py).
  vec2 gdEdgeAt( vec2 uv ) {
    return ( textureLod( uEdges, uv, 0.0 ).rg * 255.0 - 128.0 ) / ${EDGE_SCALE.toFixed(1)};
  }`
    : "";
  return /* glsl */ `${edges}
  uniform vec2 uSplatSize;
  uniform float uGroundDetail;
  uniform float uUrbanGreen;
  uniform vec3 uMeadowColor;
  uniform vec3 uRoadColor;
  uniform vec3 uSunDir; // world, surface → sun
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
export function groundFields(hasSurface: boolean, hasEdges: boolean): string {
  const distances = hasEdges
    ? /* glsl */ `
  // The baked, smoothed distance fields: valid out to ±6 m, straight along
  // a diagonal kerb. Their gradient (central differences, uv grows south).
  vec2 gdEt = 1.0 / vec2( textureSize( uEdges, 0 ) );
  vec2 gdE = gdEdgeAt( vSplatUv );
  vec2 gdEx = gdEdgeAt( vSplatUv + vec2( gdEt.x, 0.0 ) ) - gdEdgeAt( vSplatUv - vec2( gdEt.x, 0.0 ) );
  vec2 gdEy = gdEdgeAt( vSplatUv - vec2( 0.0, gdEt.y ) ) - gdEdgeAt( vSplatUv + vec2( 0.0, gdEt.y ) );
  gdDr = gdE.x;
  gdDl = gdE.y;
  gdIntoRoad = normalize( vec2( gdEx.x, gdEy.x ) + vec2( 1e-6 ) );
  gdOutOfLawn = -normalize( vec2( gdEx.y, gdEy.y ) + vec2( 1e-6 ) );
  gdHasEdge = true;`
    : /* glsl */ `
  // No baked distances (the coarse level, a site without the bake): the
  // class texels, box-smoothed near the camera. Valid within about a texel
  // of the edge only — enough for the kerb band, not for parking lanes.
  if ( grFw < 0.5 && uGroundDetail > 0.0 ) {
    vec3 gdRe;
    vec3 gdLe;
    gdSmooth( gdI, gdF, gdMpt, gdRe, gdLe );
    gdDr = gdSd( gdRe );
    gdDl = gdSd( gdLe );
    gdIntoRoad = normalize( gdRe.yz + vec2( 1e-6 ) );
    gdOutOfLawn = -normalize( gdLe.yz + vec2( 1e-6 ) );
  } else {
    gdDr = gdSd( gdRoad );
    gdDl = gdSd( gdLawn );
  }`;
  const surface = hasSurface
    ? /* glsl */ `
    ivec2 gdSs = textureSize( uSurface, 0 );
    vec4 gdS = texelFetch( uSurface, clamp( ivec2( vSplatUv * vec2( gdSs ) ), ivec2( 0 ), gdSs - 1 ), 0 );
    int gdByte = int( gdS.r * 255.0 + 0.5 );
    gdRoadKind = gdByte & 7;
    gdWalkKind = ( gdByte >> 3 ) & 7;
    gdPark = gdByte >> 6;
    float gdG = floor( gdS.g * 255.0 + 0.5 );
    if ( gdG > 0.5 ) {
      gdHasFrame = true;
      gdHead = ( gdG - 1.0 ) / 254.0 * 2.0 * PI;
      // along = offset + (position from the tile's north-west corner) · d,
      // exactly as the bake defines it (pipeline/bake/surface.py).
      float gdOffset = ( floor( gdS.b * 255.0 + 0.5 ) + floor( gdS.a * 255.0 + 0.5 ) * 256.0 ) / 65536.0 * ${ALONG_PERIOD.toFixed(1)};
      vec2 gdLocal = vec2( vSplatUv.x * uSplatSize.x, -vSplatUv.y * uSplatSize.y );
      gdAlongM = mod( gdOffset + dot( gdLocal, vec2( cos( gdHead ), sin( gdHead ) ) ), ${ALONG_PERIOD.toFixed(1)} );
    }`
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
  // Signed distance (m) to the road edge (+ on the road) and to the lawn
  // edge (+ on the lawn), with the directions into the road and out of the
  // lawn; gdHasEdge when they hold metres out, not just at the edge.
  float gdDr = -1e3;
  float gdDl = -1e3;
  vec2 gdIntoRoad = vec2( 1.0, 0.0 );
  vec2 gdOutOfLawn = vec2( 1.0, 0.0 );
  bool gdHasEdge = false;
  ${distances}
  float gdKerbOk = gdField( vec4( gdKerbable( gdC00 ), gdKerbable( gdC10 ), gdKerbable( gdC01 ), gdKerbable( gdC11 ) ), gdF, gdMpt ).x;
  int gdRoadKind = 0;
  int gdWalkKind = 0;
  int gdPark = 0;
  float gdHead = 0.0;
  bool gdHasFrame = false;
  float gdAlongM = 0.0;
  ${surface}
  int gdCls = int( grCls );
  bool gdOnRoad = gdDr > 0.0;
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
 * Urban green: built-up or unclassified ground that is green — courtyards,
 * front gardens, parks inside the settlement — painted exactly as meadow
 * (its colour, mottle, NDVI tint and lawn edge). With the baked edges the
 * mask is theirs (edges.py counts NDVI-green, unsealed built-up ground as
 * meadow); without, the NDVI decides here. Defines `ugW` either way.
 */
export function urbanGreen(hasNdvi: boolean, hasEdges: boolean): string {
  const built = `( gdCls == ${BUILTUP_CLASS} || gdCls == 0 ? 1.0 : 0.0 )`;
  let mask = "0.0";
  if (hasEdges) {
    mask = `smoothstep( -0.15, 0.15, gdDl ) * ${built}`;
  } else if (hasNdvi) {
    mask = `smoothstep( 0.22, 0.34, texture2D( uNdvi, vSplatUv, 1.0 ).r ) * ${built}
            * ( ( gdWalkKind > 0 && gdWalkKind <= ${id("sett")} ) ? 0.0 : 1.0 )
            * ( gdOnRoad ? 0.0 : 1.0 )`;
  }
  const strength = hasNdvi || hasEdges ? "uUrbanGreen" : "0.0";
  return /* glsl */ `
  float ugW = ${mask} * ${strength};
  // Meadow from here on: the colour, the mottle, and (MEADOW_NDVI, after)
  // the lush-to-dry tint and the normal break-up.
  baseCol = mix( baseCol, uMeadowColor * ( 1.0 + grMottle * 0.035 ), ugW );
  grMeadow = max( grMeadow, ugW );
  grDetail = max( grDetail, ugW * ( 1.0 - smoothstep( 0.5, 2.5, grFw ) ) );
`;
}

/** Kerbs, lawn edges and the paving patterns (after `urbanGreen`). */
export const GROUND_DETAIL = /* glsl */ `
  {
    float gdOn = uGroundDetail;
    // --- kerb: stone on the pavement side, gutter on the road side ---
    // On the fine level a real kerb stone stands on the band (kerbs.ts);
    // the band carries it into the coarse level and the far field. No
    // shading-normal step: on the raster's staircase it read as dashes.
    float gdKerb = smoothstep( 0.15, 0.35, gdKerbOk ) * gdNear * gdOn;
    float gdTop = gdBand( gdDr, -0.25, 0.0, gdW );
    float gdGutter = gdBand( gdDr, 0.0, 0.35, gdW );
    baseCol = mix( baseCol, max( baseCol * 1.08, vec3( 0.78, 0.76, 0.72 ) ), gdTop * gdKerb * 0.8 );
    baseCol *= 1.0 - gdGutter * gdKerb * 0.14 - gdBand( gdDr, 0.0, 0.08, gdW ) * gdKerb * 0.08;
    // The kerb's own shadow on the road. A 12 cm step throws a shadow a few
    // centimetres to a metre long — below what the shadow map resolves
    // (7 cm texels spread by the soft PCF, less the depth bias). Drawn from
    // the sun instead: when the sun stands behind the kerb, the road strip
    // out to H · cot(elevation) across the kerb is in its shade.
    vec2 gdSunH = vec2( uSunDir.x, -uSunDir.z ); // data frame (x east, y north)
    float gdBehind = max( -dot( gdSunH, gdIntoRoad ), 0.0 );
    float gdReach = min( ${KERB_HEIGHT.toFixed(2)} * gdBehind / max( uSunDir.y, 0.05 ), 1.5 );
    float gdCast = gdBand( gdDr, -0.01, gdReach, max( gdW, 0.02 ) ) * step( 0.02, uSunDir.y );
    baseCol *= 1.0 - gdCast * gdKerb * 0.28;

    // --- lawn edge: a darker lip and a kink where the grass stops ---
    float gdLip = gdBand( gdDl, 0.0, 0.25, gdW ) * gdNear * gdOn;
    baseCol *= 1.0 - gdLip * 0.12;
    gdTilt += gdToView( gdOutOfLawn ) * gdBand( gdDl, -0.02, 0.1, max( gdW, 0.025 ) ) * gdNear * gdOn * 0.5;

    // --- paving: along the street (q.x) and across it (q.y) ---
    // The street's own frame: q.x along it (the bake's distance along the
    // way, so bays and stone rows bend with the street), q.y across it (the
    // kerb distance near a road, which follows the kerb round a bend; else
    // across the bearing in 5° steps about the data origin, which keeps a
    // straight path seamless).
    vec2 gdAlong = vec2( cos( gdHead ), sin( gdHead ) );
    vec2 gdAcross = vec2( -gdAlong.y, gdAlong.x );
    float gdHq = floor( gdHead / ( PI / 36.0 ) + 0.5 ) * ( PI / 36.0 );
    vec2 gdAlongQ = vec2( cos( gdHq ), sin( gdHq ) );
    vec2 gdQ = vec2( dot( vWorldXY, gdAlongQ ), dot( vWorldXY, vec2( -gdAlongQ.y, gdAlongQ.x ) ) );
    if ( gdHasFrame ) {
      gdQ.x = gdAlongM;
    }
    if ( gdHasEdge && abs( gdDr ) < 6.0 ) {
      gdQ.y = gdDr;
    }
    float gdPave = gdOn * ( 1.0 - ugW );
    // Sealed ground off the carriageway (a car park, an asphalt path, a
    // concreted yard) takes on the road's grey, so it reads from afar too.
    if ( !gdOnRoad && gdWalkKind > 0 && ( gdKind == ${id("asphalt")} || gdKind == ${id("concrete")} ) ) {
      baseCol = mix( baseCol, uRoadColor * ( gdKind == ${id("concrete")} ? 1.08 : 1.0 ), 0.6 * gdPave );
    }
    if ( gdKind == ${id("asphalt")} ) {
      float n = gdNoise( vWorldXY * 1.7 ) * 0.6 + gdNoise( vWorldXY * 0.31 ) * 0.4;
      baseCol *= ( 1.0 - 0.03 * gdPave ) * ( 1.0 + ( n - 0.5 ) * 0.08 * gdMid * gdPave );
    } else if ( gdKind == ${id("concrete")} ) {
      vec2 size = vec2( 5.5, 3.0 );
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
      baseCol *= ( 1.0 + ( h - 0.5 ) * 0.04 * gdFine * gdPave ) * ( 1.0 - j * 0.09 * gdFine * gdPave );
    } else if ( gdKind == ${id("sett")} ) {
      // Abstracted: a warmer, darker tone and a fine, direction-free grain
      // at stone size — cobbles as a texture of the ground, not as drawn
      // stones. A drawn stone grid with pillow shading read as busy up
      // close and seamed where two streets' frames met.
      float n = gdNoise( vWorldXY / 0.16 ) * 0.65 + gdNoise( vWorldXY / 0.5 + 17.0 ) * 0.35;
      baseCol *= mix( vec3( 1.0 ), vec3( 0.95, 0.94, 0.93 ), gdPave )
               * ( 1.0 + ( n - 0.5 ) * 0.07 * gdFine * gdPave );
    } else if ( gdKind == ${id("unpaved")} ) {
      float n = gdNoise( vWorldXY * 3.1 ) * 0.5 + gdNoise( vWorldXY * 0.7 ) * 0.5;
      baseCol *= mix( vec3( 1.0 ), vec3( 1.03, 1.0, 0.92 ), gdPave )
               * ( 1.0 + ( n - 0.5 ) * 0.10 * gdMid * gdPave );
    } else if ( gdKind == ${id("grass")} ) {
      vec2 size = vec2( 0.55, 0.4 );
      vec2 uv = abs( gdQ / size - floor( gdQ / size + 0.5 ) );
      float hole = 1.0 - smoothstep( 0.28, 0.32, max( uv.x, uv.y ) );
      float green = mix( 0.3, hole * 0.8, gdFine );
      baseCol = mix( baseCol, uMeadowColor, green * gdPave );
    }

    // --- parking: bay lines laid out from the kerb, or across a car park ---
    float gdLine = 0.07; // half-width (m) of a painted line
    float gdPaint = 0.0;
    if ( gdOnRoad && gdHasEdge && ( gdPark == ${parkingId("street-parallel")} || gdPark == ${parkingId("street-perpendicular")} ) ) {
      bool parallel = gdPark == ${parkingId("street-parallel")};
      float depth = parallel ? 2.0 : 5.0; // m from the kerb
      float bay = parallel ? 5.5 : 2.5;   // m along the street
      float lane = gdBand( gdDr, 0.0, depth, gdW );
      float edge = gdBand( gdDr, depth - gdLine, depth + gdLine, gdW );
      float e = abs( fract( gdQ.x / bay + 0.5 ) - 0.5 ) * bay;
      float sep = 1.0 - smoothstep( gdLine - gdW, gdLine + gdW, e );
      gdPaint = max( edge, sep * lane );
      baseCol *= 1.0 - lane * 0.03 * gdMid * gdOn;
    } else if ( gdPark == ${parkingId("lot")} ) {
      // Bays side by side along the aisle (the direction), 2.5 m wide; the
      // bake clears the aisles themselves.
      float e = abs( fract( gdQ.x / 2.5 + 0.5 ) - 0.5 ) * 2.5;
      gdPaint = 1.0 - smoothstep( gdLine - gdW, gdLine + gdW, e );
    }
    float gdPaintFade = 1.0 - smoothstep( 0.06, 0.25, grFw );
    baseCol = mix( baseCol, max( baseCol, vec3( 0.86, 0.85, 0.82 ) ), gdPaint * gdPaintFade * gdOn * 0.8 );
  }
`;

/** Folds the accumulated normal tilt in (after the meadow's normal). */
export const GROUND_NORMAL = /* glsl */ `
  normal = normalize( normal + gdTilt );
`;
