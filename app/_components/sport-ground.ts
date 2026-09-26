import { srgbToLinear } from "@/lib/city/landcover";
import {
  SPORT_SURFACES,
  sportMarkingId,
  sportShapeId,
  sportSurfaceId,
} from "@/lib/city/sport";

/**
 * Sports grounds in the terrain's fragment pass (pipeline/bake/sport.py,
 * lib/city/sport.ts): a football pitch in mown stripes, a clay court, a
 * tartan oval with its lanes — the playing surface and the lines on it,
 * drawn exactly, with no geometry.
 *
 * The bake's index raster names the grounds that reach a texel (the one
 * whose outline, grown by 1.5 m, or exact, lies on top; and a second one
 * grown by 4 m, for where two meet); the fragment reads the rows of the
 * four texels around it, and for each the row's analytic shape from the
 * table texture — a rotated rectangle, a capsule band (a track), or for an
 * irregular outline the raster's own exact bit — and keeps the one it lies
 * deepest inside. So an edge is exact, not the raster's metre staircase,
 * two courts side by side meet cleanly, and a track's modelled capsule
 * holds where it strays past the mapped inner edge into the texels the
 * pitch inside claims.
 *
 * The lines are box-filtered over the pixel footprint (`spLine`): a 6 cm
 * line a hundred metres off is a faint, steady hairline, never a shimmer.
 * The textures (mown stripes, grain) scale with `groundDetail`; the colour
 * and the lines are the data and stay. Line dimensions are the standard
 * ones (FIFA, ITF, FIBA, FIVB), scaled down to fit a smaller ground.
 */

const MARK = {
  football: sportMarkingId("football"),
  tennis: sportMarkingId("tennis"),
  basketball: sportMarkingId("basketball"),
  volleyball: sportMarkingId("volleyball"),
  court: sportMarkingId("court"),
  lanes: sportMarkingId("lanes"),
  board: sportMarkingId("board"),
};
const SHAPE = {
  rect: sportShapeId("rect"),
  stadium: sportShapeId("stadium"),
  free: sportShapeId("free"),
};
const SURF = {
  grass: sportSurfaceId("grass"),
  turf: sportSurfaceId("turf"),
  sand: sportSurfaceId("sand"),
};

/** The surface palette as linear RGB, flattened in id order (`vec3[]`). */
export function sportPalette(): number[] {
  return SPORT_SURFACES.flatMap(({ srgb }) =>
    srgb ? srgb.map(srgbToLinear) : [0, 0, 0]
  );
}

const n = SPORT_SURFACES.length;

/** Declarations (after groundDetailDecl: needs gdNoise, gdHash). */
export const SPORT_DECL = /* glsl */ `
  uniform highp sampler2D uSport;
  uniform highp sampler2D uSportTable;
  uniform vec3 uSportColors[${n}];
  // The raster at a texel: the row (R, 1-based, 0 none), the second row
  // (G) and the exact bit (B).
  vec3 spAt( ivec2 p ) {
    ivec2 s = textureSize( uSport, 0 );
    vec3 t = texelFetch( uSport, clamp( p, ivec2( 0 ), s - 1 ), 0 ).rgb;
    return vec3( floor( t.rg * 255.0 + 0.5 ), t.b );
  }
  // Coverage of a line of half-width hw at distance d, box-filtered over
  // the footprint w: exact overlap of [d - w, d + w] and [-hw, hw].
  float spLine( float d, float hw, float w ) {
    return max( 0.0, min( d + w, hw ) - max( d - w, -hw ) ) / ( 2.0 * w );
  }
  // Signed distance to a box (half size b), negative inside.
  float spBox( vec2 p, vec2 b ) {
    vec2 e = abs( p ) - b;
    return length( max( e, 0.0 ) ) + min( max( e.x, e.y ), 0.0 );
  }
  float spSeg( vec2 p, vec2 a, vec2 b ) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) );
  }
  // A capsule band's paint width: the whole band, or for an oval mapped
  // filled (its infield included) the eight lanes along its edge.
  float spBandWidth( vec3 prm ) { return prm.z < 15.0 ? prm.z : 9.76; }

  // --- the line schemes, in the ground's frame (x along its long axis) ---
  // Each returns the line coverage; h = line half-width, w = footprint.
  float spFootball( vec2 q, vec2 f, float h, float w ) {
    float s = min( 1.0, min( f.x / 52.5, f.y / 34.0 ) );
    float l = spLine( spBox( q, f ), h, w );
    l = max( l, spLine( abs( q.x ), h, w ) );
    l = max( l, spLine( abs( length( q ) - 9.15 * s ), h, w ) );
    l = max( l, spLine( length( q ), 0.15, w ) );
    // One end, folded: x' from the goal line inward.
    vec2 e = vec2( f.x - abs( q.x ), q.y );
    l = max( l, spLine( spBox( e - vec2( 8.25 * s, 0.0 ), vec2( 8.25 * s, 20.16 * s ) ), h, w ) );
    l = max( l, spLine( spBox( e - vec2( 2.75 * s, 0.0 ), vec2( 2.75 * s, 9.16 * s ) ), h, w ) );
    l = max( l, spLine( length( e - vec2( 11.0 * s, 0.0 ) ), 0.12, w ) );
    float arc = abs( length( e - vec2( 11.0 * s, 0.0 ) ) - 9.15 * s );
    l = max( l, spLine( arc, h, w ) * step( 16.5 * s, e.x ) );
    // Corner arcs, 1 m.
    l = max( l, spLine( abs( length( abs( q ) - f ) - 1.0 * s ), h, w ) );
    return l * step( spBox( q, f ), h + w );
  }
  float spTennis( vec2 q, vec2 f, float h, float w ) {
    float s = min( 1.0, min( f.x / 11.885, f.y / 5.485 ) );
    vec2 d = vec2( 11.885, 5.485 ) * s;
    float single = 4.115 * s;
    float service = 6.40 * s;
    float l = spLine( spBox( q, d ), h, w );
    l = max( l, spLine( abs( abs( q.y ) - single ), h, w ) * step( abs( q.x ), d.x ) );
    l = max( l, spLine( abs( abs( q.x ) - service ), h, w ) * step( abs( q.y ), single ) );
    l = max( l, spLine( abs( q.y ), h, w ) * step( abs( q.x ), service ) );
    l = max( l, spLine( abs( q.y ), h, w ) * step( d.x - 0.1, abs( q.x ) ) * step( abs( q.x ), d.x ) );
    return l;
  }
  // One basket end: e.x from the baseline inward, s the scale.
  float spBasketEnd( vec2 e, float s, float h, float w ) {
    float l = spLine( spBox( e - vec2( 2.9 * s, 0.0 ), vec2( 2.9 * s, 2.45 * s ) ), h, w );
    l = max( l, spLine( abs( length( e - vec2( 5.8 * s, 0.0 ) ) - 1.8 * s ), h, w ) * step( 5.8 * s, e.x ) );
    float bend = 1.575 * s + sqrt( 6.75 * 6.75 - 6.6 * 6.6 ) * s;
    float three = e.x < bend
      ? abs( abs( e.y ) - 6.6 * s )
      : abs( length( e - vec2( 1.575 * s, 0.0 ) ) - 6.75 * s );
    return max( l, spLine( three, h, w ) * step( 0.0, e.x ) );
  }
  float spBasketball( vec2 q, vec2 f, float h, float w ) {
    // Nearly square: a half court, its basket at the -x end.
    if ( f.x < 1.3 * f.y ) {
      float s = min( 1.0, min( f.y / 7.5, 2.0 * f.x / 14.0 ) );
      float l = spLine( spBox( q, f ), h, w );
      return max( l, spBasketEnd( vec2( q.x + f.x, q.y ), s, h, w ) ) * step( spBox( q, f ), h + w );
    }
    float s = min( 1.0, min( f.x / 14.0, f.y / 7.5 ) );
    float l = spLine( spBox( q, f ), h, w );
    l = max( l, spLine( abs( q.x ), h, w ) );
    l = max( l, spLine( abs( length( q ) - 1.8 * s ), h, w ) );
    l = max( l, spBasketEnd( vec2( f.x - abs( q.x ), q.y ), s, h, w ) );
    return l * step( spBox( q, f ), h + w );
  }
  float spVolleyball( vec2 q, vec2 f, float h, float w, bool beach ) {
    vec2 std = beach ? vec2( 8.0, 4.0 ) : vec2( 9.0, 4.5 );
    float s = min( 1.0, min( f.x / std.x, f.y / std.y ) );
    vec2 d = std * s;
    float l = spLine( spBox( q, d ), h, w );
    l = max( l, spLine( abs( q.x ), h, w ) * step( abs( q.y ), d.y ) );
    if ( !beach ) {
      l = max( l, spLine( abs( abs( q.x ) - 3.0 * s ), h, w ) * step( abs( q.y ), d.y ) );
    }
    return l;
  }
  // Handball, futsal, the multi-sport court: the outline, the centre line
  // and a goal area at each end (6 m about the posts, joined straight).
  float spCourt( vec2 q, vec2 f, float h, float w ) {
    float s = min( 1.0, min( f.x / 20.0, f.y / 10.0 ) );
    float l = spLine( spBox( q, f ), h, w );
    l = max( l, spLine( abs( q.x ), h, w ) );
    vec2 e = vec2( f.x - abs( q.x ), max( abs( q.y ) - 1.5 * s, 0.0 ) );
    l = max( l, spLine( abs( length( e ) - 6.0 * s ), h, w ) );
    l = max( l, spLine( abs( length( q ) - 3.0 * s ), h, w ) );
    return l * step( spBox( q, f ), h + w );
  }
  // Running lanes, 1.22 m: t = the distance in from the outer edge.
  float spLanes( float t, float band, float h, float w ) {
    float k = clamp( floor( t / 1.22 + 0.5 ), 0.0, floor( band / 1.22 ) );
    return spLine( abs( t - k * 1.22 ), h, w ) * step( t, band + h + w );
  }
  float spBoard( vec2 q, vec2 f, float w ) {
    float side = min( f.x, f.y ) * 2.0 / 8.0;
    vec2 c = floor( q / side );
    float inside = step( spBox( q, vec2( side * 4.0 ) ), 0.0 );
    float dark = mod( c.x + c.y, 2.0 );
    return dark * inside * ( 1.0 - smoothstep( 0.1, 0.4, w / side ) );
  }
`;

/**
 * The ground: find the row, paint the surface, texture it, draw the lines.
 * After GROUND_DETAIL (the paving and the lawn edges lie under it) and
 * before MEADOW_NDVI (which a painted pitch opts out of).
 */
export const SPORT_GROUND = /* glsl */ `
  {
    vec2 spS = vec2( textureSize( uSport, 0 ) );
    vec2 spP = vSplatUv * spS - 0.5;
    ivec2 spI = ivec2( floor( spP ) );
    vec2 spF = spP - floor( spP );
    vec3 spT[4];
    spT[0] = spAt( spI );
    spT[1] = spAt( spI + ivec2( 1, 0 ) );
    spT[2] = spAt( spI + ivec2( 0, 1 ) );
    spT[3] = spAt( spI + ivec2( 1, 1 ) );
    if ( spT[0].x + spT[1].x + spT[2].x + spT[3].x + spT[0].y + spT[1].y + spT[2].y + spT[3].y > 0.5 ) {
      vec2 spLocal = vec2( vSplatUv.x * uSplatSize.x, -vSplatUv.y * uSplatSize.y );
      float spMpt = uSplatSize.x / spS.x;
      float spSd = 1e3;
      vec2 spQ = vec2( 0.0 );
      vec4 spPrm = vec4( 0.0 );
      for ( int k = 0; k < 8; k++ ) {
        float row = k < 4 ? spT[k].x : spT[k - 4].y;
        if ( row < 0.5 || ( k > 0 && row == ( k <= 4 ? spT[k - 1].x : spT[k - 5].y ) ) ) continue;
        vec4 a = texelFetch( uSportTable, ivec2( int( row ) - 1, 0 ), 0 );
        vec4 b = texelFetch( uSportTable, ivec2( int( row ) - 1, 1 ), 0 );
        vec2 d = spLocal - a.xy;
        vec2 q = vec2( dot( d, a.zw ), dot( d, vec2( -a.w, a.z ) ) );
        int shape = int( b.w + 0.5 ) >> 6;
        float sd;
        if ( shape == ${SHAPE.stadium} ) {
          float c = length( vec2( max( abs( q.x ) - b.x, 0.0 ), q.y ) ) - b.y;
          sd = max( c, -c - spBandWidth( b.xyz ) );
        } else if ( shape == ${SHAPE.free} ) {
          vec4 in4 = vec4(
            spT[0].x == row && spT[0].z > 0.5, spT[1].x == row && spT[1].z > 0.5,
            spT[2].x == row && spT[2].z > 0.5, spT[3].x == row && spT[3].z > 0.5 );
          float cov = mix( mix( in4.x, in4.y, spF.x ), mix( in4.z, in4.w, spF.x ), spF.y );
          sd = ( 0.5 - cov ) * spMpt;
        } else {
          sd = spBox( q, b.xy );
        }
        if ( sd < spSd ) {
          spSd = sd;
          spQ = q;
          spPrm = b;
        }
      }
      int spCode = int( spPrm.w + 0.5 );
      int spSurf = spCode & 7;
      int spMark = ( spCode >> 3 ) & 7;
      int spShape = spCode >> 6;
      float spIn = 1.0 - smoothstep( -gdW, gdW, spSd );
      float spTex = uGroundDetail;
      if ( spSurf > 0 && spIn > 0.0 ) {
        vec3 col = uSportColors[ spSurf ];
        float grain = gdNoise( vWorldXY * 2.3 ) * 0.6 + gdNoise( vWorldXY * 0.45 + 7.0 ) * 0.4;
        if ( spSurf == ${SURF.grass} || spSurf == ${SURF.turf} ) {
          // Mown stripes across the long axis, ~5.5 m, whole stripes to a
          // pitch; broad enough to hold from the air.
          float count = max( 2.0, 2.0 * floor( spPrm.x / 5.5 + 0.5 ) );
          float sw = 2.0 * spPrm.x / count;
          float t = abs( fract( spQ.x / sw ) - 0.5 ) * 2.0;
          float aa = min( gdW / sw * 2.0, 0.5 );
          float band = smoothstep( 0.5 - aa, 0.5 + aa, t );
          float depth = spSurf == ${SURF.grass} ? 0.045 : 0.025;
          col *= 1.0 + ( band - 0.5 ) * 2.0 * depth * spTex * ( 1.0 - smoothstep( 0.8, 2.5, grFw ) );
          col *= 1.0 + ( grain - 0.5 ) * 0.05 * gdMid * spTex;
        } else if ( spSurf == ${SURF.sand} ) {
          col *= 1.0 + ( grain - 0.5 ) * 0.09 * gdMid * spTex;
        } else {
          col *= 1.0 + ( grain - 0.5 ) * 0.04 * gdMid * spTex;
        }
        baseCol = mix( baseCol, col, spIn );
        // A painted ground is not meadow: no NDVI drift, no grass break-up.
        grMeadow *= 1.0 - spIn;
        grDetail *= 1.0 - spIn;
      }
      // --- the lines ---
      float h = 0.06;
      float w = max( gdW, 0.004 );
      vec2 f = spPrm.xy - vec2( clamp( 0.03 * spPrm.y, 0.3, 1.5 ) );
      float l = 0.0;
      if ( spShape == ${SHAPE.stadium} ) {
        if ( spMark == ${MARK.lanes} ) {
          float c = length( vec2( max( abs( spQ.x ) - spPrm.x, 0.0 ), spQ.y ) ) - spPrm.y;
          float band = spBandWidth( spPrm.xyz );
          l = spLanes( -c - 0.05, band - 0.1, h, w );
          // The finish line across the lanes, where the home straight ends.
          l = max( l, spLine( abs( spQ.x - spPrm.x ), h, w ) * step( spQ.y, 0.0 ) * step( -c, band ) );
        }
      } else if ( spShape == ${SHAPE.rect} ) {
        if ( spMark == ${MARK.football} ) {
          l = spFootball( spQ, f, h, w );
        } else if ( spMark == ${MARK.tennis} ) {
          l = spTennis( spQ, spPrm.xy - 0.3, h * 0.85, w );
        } else if ( spMark == ${MARK.basketball} ) {
          l = spBasketball( spQ, f, h * 0.85, w );
        } else if ( spMark == ${MARK.volleyball} ) {
          l = spVolleyball( spQ, f, h * 0.85, w, spSurf == ${SURF.sand} );
        } else if ( spMark == ${MARK.court} ) {
          l = spCourt( spQ, f, h * 0.85, w );
        } else if ( spMark == ${MARK.lanes} ) {
          l = spLanes( spQ.y + spPrm.y - 0.3, 2.0 * spPrm.y - 0.6, h, w );
        } else if ( spMark == ${MARK.board} ) {
          baseCol *= 1.0 - 0.3 * spBoard( spQ, spPrm.xy - 0.5, w ) * spIn;
        }
      }
      // Warm white chalk; on sand, the blue of beach-volleyball tape.
      vec3 ink = spSurf == ${SURF.sand} ? vec3( 0.2, 0.33, 0.55 ) : vec3( 0.86, 0.84, 0.78 );
      float fade = 1.0 - smoothstep( 0.6, 1.6, grFw );
      baseCol = mix( baseCol, ink, clamp( l, 0.0, 1.0 ) * spIn * fade * 0.9 );
    }
  }
`;
