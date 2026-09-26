import {
  LANE_BITS,
  MARKING_OFFSET_SCALE,
  MARKING_PATTERN as P,
  markingKindId,
} from "@/lib/city/markings";

/**
 * Road markings in the terrain's fragment pass (pipeline/bake/markings.py,
 * lib/city/markings.ts, plan 026), after the sports grounds: paint, no
 * geometry.
 *
 * - **Crossings and stop lines** come from a table of rotated rectangles
 *   (axis across the road); the index raster names the rows whose outline,
 *   grown by 1 m, reaches a texel. A zebra is 0.5 m bars across the whole
 *   crossing, a *Furt* (a signalled crossing) two broken 12 cm lines along
 *   its edges, a stop line one 0.5 m bar.
 * - **Cycle lanes**: a broken 25 cm line 1.85 m from the kerb (the baked
 *   kerb distance), on the side of the way the raster's bit says.
 * - **Centre lines**: 12 cm dashes (3 m in 8.25 m) where the baked signed
 *   distance to the carriageway's middle crosses zero.
 *
 * Every line is box-filtered over the pixel footprint (`rmLine`,
 * `rmStripes` — the exact coverage, so a zebra far off averages to a pale
 * band instead of shimmering), clipped to the carriageway by the kerb
 * distance, worn by a low-frequency mottle, and scaled by *Bodendetail*
 * (0 = no paint). Needs `groundDetailDecl` and `groundFields` in scope.
 */

const ZEBRA = markingKindId("zebra");
const FURT = markingKindId("furt");
const STOP = markingKindId("stop");
const f = (v: number) => v.toFixed(4);

/** Declarations (after groundDetailDecl). */
export const MARKINGS_DECL = /* glsl */ `
  uniform highp sampler2D uMarkings;
  uniform highp sampler2D uMarkingTable;
  // The raster's bytes at a texel: row (R + 256 A, 1-based), bits, offset.
  vec3 rmAt( ivec2 p ) {
    ivec2 s = textureSize( uMarkings, 0 );
    vec4 t = floor( texelFetch( uMarkings, clamp( p, ivec2( 0 ), s - 1 ), 0 ) * 255.0 + 0.5 );
    return vec3( t.r + 256.0 * t.a, t.g, t.b );
  }
  // Coverage of |d| < hw over the footprint [d - w, d + w].
  float rmLine( float d, float hw, float w ) {
    return max( 0.0, min( d + w, hw ) - max( d - w, -hw ) ) / ( 2.0 * w );
  }
  // Coverage of stripes [k P, k P + a) over [x - w, x + w], exactly.
  float rmCum( float t, float a, float p ) {
    float k = floor( t / p );
    return k * a + min( t - k * p, a );
  }
  float rmStripes( float x, float a, float p, float w ) {
    return ( rmCum( x + w, a, p ) - rmCum( x - w, a, p ) ) / ( 2.0 * w );
  }
  // One table row's paint at the local position (m from the tile's NW corner).
  float rmRow( float row, vec2 local, float w ) {
    vec4 a = texelFetch( uMarkingTable, ivec2( int( row ) - 1, 0 ), 0 );
    vec4 b = texelFetch( uMarkingTable, ivec2( int( row ) - 1, 1 ), 0 );
    vec2 d = local - a.xy;
    // q.x across the road (the way a pedestrian walks), q.y along it
    vec2 q = vec2( dot( d, a.zw ), dot( d, vec2( -a.w, a.z ) ) );
    int kind = int( b.z + 0.5 );
    float across = rmLine( q.x, b.x, w );
    if ( kind == ${ZEBRA} ) {
      return across * rmLine( q.y, b.y, w ) * rmStripes( q.x + b.x, ${f(P.zebraBar)}, ${f(P.zebraPeriod)}, w );
    }
    if ( kind == ${FURT} ) {
      float edge = rmLine( abs( q.y ) - b.y, ${f(P.furtHalfWidth)}, w );
      return across * edge * rmStripes( q.x + b.x, ${f(P.furtDash)}, ${f(P.furtPeriod)}, w );
    }
    if ( kind == ${STOP} ) {
      return across * rmLine( q.y, b.y, w );
    }
    return 0.0;
  }
`;

/** The paint (after SPORT_GROUND; needs the ground fields in scope). */
export const ROAD_MARKINGS = /* glsl */ `
  if ( uGroundDetail > 0.0 && grFw < 1.5 ) {
    vec2 rmS = vec2( textureSize( uMarkings, 0 ) );
    vec2 rmP = vSplatUv * rmS - 0.5;
    ivec2 rmI = ivec2( floor( rmP ) );
    vec2 rmF = rmP - floor( rmP );
    vec3 rmT0 = rmAt( rmI );
    vec3 rmT1 = rmAt( rmI + ivec2( 1, 0 ) );
    vec3 rmT2 = rmAt( rmI + ivec2( 0, 1 ) );
    vec3 rmT3 = rmAt( rmI + ivec2( 1, 1 ) );
    float rmW = max( gdW, 0.004 );
    vec2 rmLocal = vec2( vSplatUv.x * uSplatSize.x, -vSplatUv.y * uSplatSize.y );
    float rmPaint = 0.0;
    // crossings and stop lines: every distinct row among the four texels
    if ( rmT0.x > 0.5 ) rmPaint = max( rmPaint, rmRow( rmT0.x, rmLocal, rmW ) );
    if ( rmT1.x > 0.5 && rmT1.x != rmT0.x ) rmPaint = max( rmPaint, rmRow( rmT1.x, rmLocal, rmW ) );
    if ( rmT2.x > 0.5 && rmT2.x != rmT0.x && rmT2.x != rmT1.x ) rmPaint = max( rmPaint, rmRow( rmT2.x, rmLocal, rmW ) );
    if ( rmT3.x > 0.5 && rmT3.x != rmT0.x && rmT3.x != rmT1.x && rmT3.x != rmT2.x ) rmPaint = max( rmPaint, rmRow( rmT3.x, rmLocal, rmW ) );
    if ( gdHasEdge && gdDr > 0.0 ) {
      // along the street: the paving raster's frame, else the bearing's
      vec2 rmDir = vec2( cos( gdHead ), sin( gdHead ) );
      float rmAlong = gdHasFrame ? gdAlongM : dot( vWorldXY, rmDir );
      vec3 rmN = rmF.x < 0.5 ? ( rmF.y < 0.5 ? rmT0 : rmT2 ) : ( rmF.y < 0.5 ? rmT1 : rmT3 );
      int rmBits = int( rmN.y );
      if ( ( rmBits & ${LANE_BITS.cycle} ) != 0 ) {
        float line = rmLine( gdDr - ${f(P.cycleFromKerb)}, ${f(P.cycleHalfWidth)}, rmW );
        rmPaint = max( rmPaint, line * rmStripes( rmAlong, ${f(P.cyclePeriod / 2)}, ${f(P.cyclePeriod)}, rmW ) );
      }
      int rmAll = int( rmT0.y ) & int( rmT1.y ) & int( rmT2.y ) & int( rmT3.y );
      if ( ( rmAll & ${LANE_BITS.centre} ) != 0 ) {
        float s = mix( mix( rmT0.z, rmT1.z, rmF.x ), mix( rmT2.z, rmT3.z, rmF.x ), rmF.y );
        s = ( s - 128.0 ) / ${MARKING_OFFSET_SCALE.toFixed(1)};
        float line = rmLine( s, ${f(P.centreHalfWidth)}, rmW );
        rmPaint = max( rmPaint, line * rmStripes( rmAlong, ${f(P.centreDash)}, ${f(P.centrePeriod)}, rmW ) );
      }
    }
    // on the carriageway only (a crossing a little off the DLM road stops
    // at the kerb), worn, and gone before it could crawl in the distance
    float rmRoad = gdHasEdge ? smoothstep( -rmW, rmW, gdDr ) : 1.0;
    float rmWear = 0.78 + 0.22 * gdNoise( vWorldXY * 0.37 + 3.0 );
    float rmFade = 1.0 - smoothstep( 0.5, 1.5, grFw );
    float rmOn = min( uGroundDetail / 0.7, 1.0 ) * 0.85;
    baseCol = mix( baseCol, max( baseCol, vec3( 0.88, 0.87, 0.83 ) ), clamp( rmPaint, 0.0, 1.0 ) * rmRoad * rmWear * rmFade * rmOn );
  }
`;
