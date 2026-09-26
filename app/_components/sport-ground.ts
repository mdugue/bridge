import type { Node, Texture } from "three/webgpu";
import {
  abs,
  and,
  clamp,
  dot,
  float,
  floor,
  fract,
  Fn,
  If,
  int,
  ivec2,
  length,
  Loop,
  max,
  min,
  mix,
  or,
  select,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { srgbToLinear } from "@/lib/city/landcover";
import {
  SPORT_SURFACES,
  sportMarkingId,
  sportShapeId,
  sportSurfaceId,
} from "@/lib/city/sport";
import type { F, V2, V3, V4 } from "./shader-chunks";
import {
  byteOf,
  floorMod,
  gdNoise,
  loadTexel,
  type GroundColour,
  type GroundFields,
  type GroundInputs,
  texelAt,
  texelSize,
} from "./ground-detail";

/**
 * Sports grounds in the terrain's colour node (pipeline/bake/sport.py,
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

type I = Node<"int">;

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

/** The surface palette as linear RGB, flattened in id order. */
export function sportPalette(): number[] {
  return SPORT_SURFACES.flatMap(({ srgb }) =>
    srgb ? srgb.map(srgbToLinear) : [0, 0, 0]
  );
}

const PALETTE = sportPalette();

/** A surface's colour by id (a select chain over the few surfaces). */
function surfaceColour(surf: I): V3 {
  let col: V3 = vec3(PALETTE[0], PALETTE[1], PALETTE[2]);
  for (let k = 1; k < SPORT_SURFACES.length; k++) {
    const c = vec3(PALETTE[k * 3], PALETTE[k * 3 + 1], PALETTE[k * 3 + 2]);
    col = select(surf.equal(k), c, col);
  }
  return col;
}

/**
 * Coverage of a line of half-width hw at distance d, box-filtered over
 * the footprint w: exact overlap of [d − w, d + w] and [−hw, hw]. A shader
 * function: the line schemes call it dozens of times.
 */
export const spLine = Fn(
  ([d, hw, w]: [F, F, F]): F =>
    max(0, min(d.add(w), hw).sub(max(d.sub(w), hw.negate()))).div(w.mul(2)),
  { d: "float", hw: "float", w: "float", return: "float" }
);

/** Signed distance to a box (half size b), negative inside. */
const spBox = Fn(
  ([p, b]: [V2, V2]): F => {
    const e = abs(p).sub(b).toVar();
    return length(max(e, vec2(0))).add(min(max(e.x, e.y), 0));
  },
  { p: "vec2", b: "vec2", return: "float" }
);

/** A capsule band's paint width: the whole band, or for an oval mapped
 *  filled (its infield included) the eight lanes along its edge. */
const spBandWidth = (prm: V3): F => select(prm.z.lessThan(15), prm.z, 9.76);

// --- the line schemes, in the ground's frame (x along its long axis) ---------
// Each returns the line coverage; h = line half-width, w = footprint.

function spFootball(q: V2, f: V2, h: F, w: F): F {
  const s = min(1, min(f.x.div(52.5), f.y.div(34)));
  let l = spLine(spBox(q, f), h, w);
  l = max(l, spLine(abs(q.x), h, w));
  l = max(l, spLine(abs(length(q).sub(s.mul(9.15))), h, w));
  l = max(l, spLine(length(q), 0.15, w));
  // One end, folded: x' from the goal line inward.
  const e = vec2(f.x.sub(abs(q.x)), q.y);
  l = max(
    l,
    spLine(
      spBox(e.sub(vec2(s.mul(8.25), 0)), vec2(s.mul(8.25), s.mul(20.16))),
      h,
      w
    )
  );
  l = max(
    l,
    spLine(
      spBox(e.sub(vec2(s.mul(2.75), 0)), vec2(s.mul(2.75), s.mul(9.16))),
      h,
      w
    )
  );
  const spot = length(e.sub(vec2(s.mul(11), 0)));
  l = max(l, spLine(spot, 0.12, w));
  const arc = abs(spot.sub(s.mul(9.15)));
  l = max(l, spLine(arc, h, w).mul(step(s.mul(16.5), e.x)));
  // Corner arcs, 1 m.
  l = max(l, spLine(abs(length(abs(q).sub(f)).sub(s)), h, w));
  return l.mul(step(spBox(q, f), h.add(w)));
}

function spTennis(q: V2, f: V2, h: F, w: F): F {
  const s = min(1, min(f.x.div(11.885), f.y.div(5.485)));
  const d = vec2(11.885, 5.485).mul(s);
  const single = s.mul(4.115);
  const service = s.mul(6.4);
  const ax = abs(q.x);
  const ay = abs(q.y);
  let l = spLine(spBox(q, d), h, w);
  l = max(l, spLine(abs(ay.sub(single)), h, w).mul(step(ax, d.x)));
  l = max(l, spLine(abs(ax.sub(service)), h, w).mul(step(ay, single)));
  l = max(l, spLine(ay, h, w).mul(step(ax, service)));
  l = max(
    l,
    spLine(ay, h, w)
      .mul(step(d.x.sub(0.1), ax))
      .mul(step(ax, d.x))
  );
  return l;
}

/** One basket end: e.x from the baseline inward, s the scale. */
function spBasketEnd(e: V2, s: F, h: F, w: F): F {
  let l = spLine(
    spBox(e.sub(vec2(s.mul(2.9), 0)), vec2(s.mul(2.9), s.mul(2.45))),
    h,
    w
  );
  l = max(
    l,
    spLine(abs(length(e.sub(vec2(s.mul(5.8), 0))).sub(s.mul(1.8))), h, w).mul(
      step(s.mul(5.8), e.x)
    )
  );
  const bend = s.mul(1.575).add(s.mul(Math.sqrt(6.75 * 6.75 - 6.6 * 6.6)));
  const three = select(
    e.x.lessThan(bend),
    abs(abs(e.y).sub(s.mul(6.6))),
    abs(length(e.sub(vec2(s.mul(1.575), 0))).sub(s.mul(6.75)))
  );
  return max(l, spLine(three, h, w).mul(step(0, e.x)));
}

function spBasketball(q: V2, f: V2, h: F, w: F): F {
  const clip = step(spBox(q, f), h.add(w));
  const outline = spLine(spBox(q, f), h, w);
  // Nearly square: a half court, its basket at the −x end.
  const hs = min(1, min(f.y.div(7.5), f.x.mul(2).div(14)));
  const half = max(outline, spBasketEnd(vec2(q.x.add(f.x), q.y), hs, h, w)).mul(
    clip
  );
  const s = min(1, min(f.x.div(14), f.y.div(7.5)));
  let l = max(outline, spLine(abs(q.x), h, w));
  l = max(l, spLine(abs(length(q).sub(s.mul(1.8))), h, w));
  l = max(l, spBasketEnd(vec2(f.x.sub(abs(q.x)), q.y), s, h, w));
  return select(f.x.lessThan(f.y.mul(1.3)), half, l.mul(clip));
}

function spVolleyball(q: V2, f: V2, h: F, w: F, beach: Node<"bool">): F {
  const std = select(beach, vec2(8, 4), vec2(9, 4.5));
  const s = min(1, min(f.x.div(std.x), f.y.div(std.y)));
  const d = std.mul(s);
  const inY = step(abs(q.y), d.y);
  let l = spLine(spBox(q, d), h, w);
  l = max(l, spLine(abs(q.x), h, w).mul(inY));
  const attack = max(l, spLine(abs(abs(q.x).sub(s.mul(3))), h, w).mul(inY));
  return select(beach, l, attack);
}

/** Handball, futsal, the multi-sport court: the outline, the centre line
 *  and a goal area at each end (6 m about the posts, joined straight). */
function spCourt(q: V2, f: V2, h: F, w: F): F {
  const s = min(1, min(f.x.div(20), f.y.div(10)));
  let l = spLine(spBox(q, f), h, w);
  l = max(l, spLine(abs(q.x), h, w));
  const e = vec2(f.x.sub(abs(q.x)), max(abs(q.y).sub(s.mul(1.5)), 0));
  l = max(l, spLine(abs(length(e).sub(s.mul(6))), h, w));
  l = max(l, spLine(abs(length(q).sub(s.mul(3))), h, w));
  return l.mul(step(spBox(q, f), h.add(w)));
}

/** Running lanes, 1.22 m: t = the distance in from the outer edge. */
function spLanes(t: F, band: F, h: F, w: F): F {
  const k = clamp(floor(t.div(1.22).add(0.5)), 0, floor(band.div(1.22)));
  return spLine(abs(t.sub(k.mul(1.22))), h, w).mul(step(t, band.add(h).add(w)));
}

function spBoard(q: V2, f: V2, w: F): F {
  const side = min(f.x, f.y).mul(2).div(8);
  const c = floor(q.div(side));
  const inside = step(spBox(q, vec2(side.mul(4))), 0);
  const dark = floorMod(c.x.add(c.y), 2);
  return dark.mul(inside).mul(float(1).sub(smoothstep(0.1, 0.4, w.div(side))));
}

// --- the ground ----------------------------------------------------------------

/** The raster at a texel: the row (R, 1-based, 0 none), the second row
 *  (G) and the exact bit (B). */
function spAt(raster: Texture, p: Node<"ivec2">, size: Node<"ivec2">): V3 {
  const t = texelAt(raster, p, size);
  return vec3(byteOf(t.r), byteOf(t.g), t.b);
}

interface Nearest {
  /** the winner's signed distance (m), frame position and table row b */
  sd: F;
  q: V2;
  prm: V4;
}

/** The four texels' rows, each once, and the one the fragment lies
 *  deepest inside: a loop over the eight row slots (the first rows, then
 *  the second), a slot skipped when empty or when it repeats the one
 *  before it. */
function nearestGround(
  table: Texture,
  t: V3[],
  f: V2,
  mpt: F,
  local: V2
): Nearest {
  const best: Nearest = {
    sd: float(1e3).toVar(),
    q: vec2(0).toVar(),
    prm: vec4(0).toVar(),
  };
  const texel = (j: I): V3 =>
    select(
      j.equal(0),
      t[0],
      select(j.equal(1), t[1], select(j.equal(2), t[2], t[3]))
    );
  const rowOf = (k: I): F =>
    select(k.lessThan(4), texel(k).x, texel(k.sub(4)).y);
  Loop(8, ({ i: k }) => {
    const row = rowOf(k).toVar();
    const seen = and(k.greaterThan(0), row.equal(rowOf(k.sub(1))));
    If(or(row.lessThan(0.5), seen).not(), () => {
      const at = int(row).sub(1);
      const a = loadTexel(table, ivec2(at, 0)).toVar();
      const b = loadTexel(table, ivec2(at, 1)).toVar();
      const d = local.sub(a.xy);
      const q = vec2(dot(d, a.zw), dot(d, vec2(a.w.negate(), a.z))).toVar();
      const shape = int(b.w.add(0.5)).shiftRight(6).toVar();
      const sd = float(0).toVar();
      If(shape.equal(SHAPE.stadium), () => {
        const c = length(vec2(max(abs(q.x).sub(b.x), 0), q.y))
          .sub(b.y)
          .toVar();
        sd.assign(max(c, c.negate().sub(spBandWidth(b.xyz))));
      })
        .ElseIf(shape.equal(SHAPE.free), () => {
          const hit = (j: number): F =>
            select(and(t[j].x.equal(row), t[j].z.greaterThan(0.5)), 1, 0);
          const cov = mix(
            mix(hit(0), hit(1), f.x),
            mix(hit(2), hit(3), f.x),
            f.y
          );
          sd.assign(float(0.5).sub(cov).mul(mpt));
        })
        .Else(() => {
          sd.assign(spBox(q, b.xy));
        });
      If(sd.lessThan(best.sd), () => {
        best.sd.assign(sd);
        best.q.assign(q);
        best.prm.assign(b);
      });
    });
  });
  return best;
}

/** The playing surface: its colour, mown stripes and grain. */
function surfacePaint(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  n: Nearest,
  surf: I,
  inside: F
): void {
  const tex = inp.groundDetail;
  If(and(surf.greaterThan(0), inside.greaterThan(0)), () => {
    const c = surfaceColour(surf).toVar();
    const grain = gdNoise(inp.xy.mul(2.3))
      .mul(0.6)
      .add(gdNoise(inp.xy.mul(0.45).add(7)).mul(0.4))
      .toVar();
    If(or(surf.equal(SURF.grass), surf.equal(SURF.turf)), () => {
      // Mown stripes across the long axis, ~5.5 m, whole stripes to a
      // pitch; broad enough to hold from the air.
      const count = max(2, floor(n.prm.x.div(5.5).add(0.5)).mul(2));
      const sw = n.prm.x.mul(2).div(count).toVar();
      const t = abs(fract(n.q.x.div(sw)).sub(0.5)).mul(2);
      const aa = min(g.w.div(sw).mul(2), 0.5).toVar();
      const band = smoothstep(float(0.5).sub(aa), aa.add(0.5), t);
      const depth = select(surf.equal(SURF.grass), 0.045, 0.025);
      c.mulAssign(
        band
          .sub(0.5)
          .mul(2)
          .mul(depth)
          .mul(tex)
          .mul(float(1).sub(smoothstep(0.8, 2.5, inp.fw)))
          .add(1)
      );
      c.mulAssign(grain.sub(0.5).mul(0.05).mul(g.mid).mul(tex).add(1));
    })
      .ElseIf(surf.equal(SURF.sand), () => {
        c.mulAssign(grain.sub(0.5).mul(0.09).mul(g.mid).mul(tex).add(1));
      })
      .Else(() => {
        c.mulAssign(grain.sub(0.5).mul(0.04).mul(g.mid).mul(tex).add(1));
      });
    col.baseCol.assign(mix(col.baseCol, c, inside));
    // A painted ground is not meadow: no NDVI drift, no grass break-up.
    col.meadow.mulAssign(float(1).sub(inside));
    col.detail.mulAssign(float(1).sub(inside));
  });
}

/** The lines of the ground's scheme (coverage 0..1). */
function lines(
  col: GroundColour,
  n: Nearest,
  code: { mark: I; shape: I; surf: I },
  w: F,
  inside: F
): F {
  const h = float(0.06);
  const hs = h.mul(0.85);
  const { q, prm } = n;
  const f = prm.xy.sub(vec2(clamp(prm.y.mul(0.03), 0.3, 1.5))).toVar();
  const l = float(0).toVar();
  If(code.shape.equal(SHAPE.stadium), () => {
    If(code.mark.equal(MARK.lanes), () => {
      const c = length(vec2(max(abs(q.x).sub(prm.x), 0), q.y))
        .sub(prm.y)
        .toVar();
      const band = spBandWidth(prm.xyz).toVar();
      l.assign(spLanes(c.negate().sub(0.05), band.sub(0.1), h, w));
      // The finish line across the lanes, where the home straight ends.
      l.assign(
        max(
          l,
          spLine(abs(q.x.sub(prm.x)), h, w)
            .mul(step(q.y, 0))
            .mul(step(c.negate(), band))
        )
      );
    });
  }).ElseIf(code.shape.equal(SHAPE.rect), () => {
    If(code.mark.equal(MARK.football), () => {
      l.assign(spFootball(q, f, h, w));
    })
      .ElseIf(code.mark.equal(MARK.tennis), () => {
        l.assign(spTennis(q, prm.xy.sub(0.3), hs, w));
      })
      .ElseIf(code.mark.equal(MARK.basketball), () => {
        l.assign(spBasketball(q, f, hs, w));
      })
      .ElseIf(code.mark.equal(MARK.volleyball), () => {
        l.assign(spVolleyball(q, f, hs, w, code.surf.equal(SURF.sand)));
      })
      .ElseIf(code.mark.equal(MARK.court), () => {
        l.assign(spCourt(q, f, hs, w));
      })
      .ElseIf(code.mark.equal(MARK.lanes), () => {
        l.assign(spLanes(q.y.add(prm.y).sub(0.3), prm.y.mul(2).sub(0.6), h, w));
      })
      .ElseIf(code.mark.equal(MARK.board), () => {
        col.baseCol.mulAssign(
          float(1).sub(spBoard(q, prm.xy.sub(0.5), w).mul(inside).mul(0.3))
        );
      });
  });
  return l;
}

/**
 * The ground: find the row, paint the surface, texture it, draw the lines.
 * After `groundDetail` (the paving and the lawn edges lie under it) and
 * before the meadow's NDVI tint (which a painted pitch opts out of).
 */
export function sportGround(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  sport: { raster: Texture; table: Texture }
): void {
  const size = texelSize(sport.raster, inp.uv).toVar();
  const s = vec2(size).toVar();
  const p = inp.uv.mul(s).sub(0.5).toVar();
  const i = ivec2(floor(p)).toVar();
  const f = p.sub(floor(p)).toVar();
  const t = [
    spAt(sport.raster, i, size).toVar(),
    spAt(sport.raster, i.add(ivec2(1, 0)), size).toVar(),
    spAt(sport.raster, i.add(ivec2(0, 1)), size).toVar(),
    spAt(sport.raster, i.add(ivec2(1, 1)), size).toVar(),
  ];
  const any = t[0].x
    .add(t[1].x)
    .add(t[2].x)
    .add(t[3].x)
    .add(t[0].y)
    .add(t[1].y)
    .add(t[2].y)
    .add(t[3].y);
  If(any.greaterThan(0.5), () => {
    const mpt = float(inp.size[0]).div(s.x).toVar();
    const n = nearestGround(sport.table, t, f, mpt, g.local);
    const code = int(n.prm.w.add(0.5)).toVar();
    const surf = code.bitAnd(7).toVar();
    const mark = code.shiftRight(3).bitAnd(7).toVar();
    const shape = code.shiftRight(6).toVar();
    const inside = float(1)
      .sub(smoothstep(g.w.negate(), g.w, n.sd))
      .toVar();
    surfacePaint(inp, col, g, n, surf, inside);
    // --- the lines ---
    const w = max(g.w, 0.004).toVar();
    const l = lines(col, n, { mark, shape, surf }, w, inside);
    // Warm white chalk; on sand, the blue of beach-volleyball tape.
    const ink = select(
      surf.equal(SURF.sand),
      vec3(0.2, 0.33, 0.55),
      vec3(0.86, 0.84, 0.78)
    );
    const fade = float(1).sub(smoothstep(0.6, 1.6, inp.fw));
    col.baseCol.assign(
      mix(col.baseCol, ink, clamp(l, 0, 1).mul(inside).mul(fade).mul(0.9))
    );
  });
}
