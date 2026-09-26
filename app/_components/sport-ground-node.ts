import type { Texture } from "three";
import {
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  If,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  mod,
  select,
  smoothstep,
  step,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { sportMarkingId, sportShapeId, sportSurfaceId } from "@/lib/city/sport";
import {
  type Fields,
  type GroundInputs,
  type MeadowVars,
  noise,
} from "./ground-detail-node";
import { sportPalette } from "./sport-ground";

/**
 * SPIKE (plan 020): sport-ground.ts in TSL — the sports grounds painted in
 * the terrain's fragment pass, term for term; sport-ground.ts stays the
 * source of truth. The packed code's bit fields (`& 7`, `>> 3`, `>> 6`) are
 * exact float math on small integers (floor, mod). The eight-row search is
 * unrolled in JS, each row under an `If` (the GLSL's `continue`), so a
 * texel naming no ground never reads the table. The outline models and the
 * small ternaries inside the line schemes are `select`s (all candidates are
 * cheap); the line schemes themselves are an `If` chain on shape and
 * marking, as in the GLSL, since evaluating all seven would be wasteful.
 */

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;
type V4 = Node<"vec4">;
type B = Node<"bool">;
type N = F | number;
type Live = { value: number };

const live = (ref: Live) => uniform(ref.value).onRenderUpdate(() => ref.value);
const num = (x: N): F => (typeof x === "number" ? float(x) : x);
const texSize = (t: Texture): [number, number] => {
  const img = t.image as { height: number; width: number };
  return [img.width, img.height];
};

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
const PALETTE = sportPalette();
/** sqrt(6.75² − 6.6²): where the three-point line leaves its straights. */
const THREE_BEND = Math.sqrt(6.75 * 6.75 - 6.6 * 6.6);

/** spAt: the row (R), the second row (G) and the exact bit (B) at a texel. */
function rasterReader(raster: Texture) {
  const [sw, sh] = texSize(raster);
  const hi = ivec2(sw - 1, sh - 1);
  return (p: Node<"ivec2">): V3 => {
    const t = textureLoad(
      raster,
      // reason: @types/three types clamp for float vectors; WGSL/GLSL
      // clamp takes ivec2 fine (as in ground-detail-node.ts).
      clamp(p as never, ivec2(0, 0) as never, hi as never)
    );
    return vec3(floor(t.rg.mul(255).add(0.5)), t.b);
  };
}

/** spLine: a line of half-width hw at d, box-filtered over the footprint w. */
function line(d: F, hw: N, w: F): F {
  const h = num(hw);
  return max(0, min(d.add(w), h).sub(max(d.sub(w), h.negate()))).div(w.mul(2));
}

/** spBox: signed distance to a box (half size b), negative inside. */
function box(p: V2, b: V2): F {
  const e = abs(p).sub(b);
  return length(max(e, 0)).add(min(max(e.x, e.y), 0));
}

/** spBandWidth: a capsule's paint width (the band, or eight lanes). */
function bandWidth(prm: V3): F {
  return select(prm.z.lessThan(15), prm.z, float(9.76));
}

/** min(1, a, b): the scale that fits a standard layout into the ground. */
const fit = (a: F, b: F): F => min(1, min(a, b));

/** spFootball: FIFA lines, scaled down to a smaller pitch. */
function football(q: V2, f: V2, h: F, w: F): F {
  const s = fit(f.x.div(52.5), f.y.div(34));
  let l = line(box(q, f), h, w);
  l = max(l, line(abs(q.x), h, w));
  l = max(l, line(abs(length(q).sub(s.mul(9.15))), h, w));
  l = max(l, line(length(q), 0.15, w));
  // One end, folded: x' from the goal line inward.
  const e = vec2(f.x.sub(abs(q.x)), q.y);
  l = max(
    l,
    line(
      box(e.sub(vec2(s.mul(8.25), 0)), vec2(s.mul(8.25), s.mul(20.16))),
      h,
      w
    )
  );
  l = max(
    l,
    line(box(e.sub(vec2(s.mul(2.75), 0)), vec2(s.mul(2.75), s.mul(9.16))), h, w)
  );
  const spot = length(e.sub(vec2(s.mul(11), 0)));
  l = max(l, line(spot, 0.12, w));
  const arc = abs(spot.sub(s.mul(9.15)));
  l = max(l, line(arc, h, w).mul(step(s.mul(16.5), e.x)));
  // Corner arcs, 1 m.
  l = max(l, line(abs(length(abs(q).sub(f)).sub(s)), h, w));
  return l.mul(step(box(q, f), h.add(w)));
}

/** spTennis: ITF lines (no mask: the court is drawn to its own size). */
function tennis(q: V2, f: V2, h: F, w: F): F {
  const s = fit(f.x.div(11.885), f.y.div(5.485));
  const d = vec2(11.885, 5.485).mul(s);
  const single = s.mul(4.115);
  const service = s.mul(6.4);
  const ax = abs(q.x);
  const ay = abs(q.y);
  let l = line(box(q, d), h, w);
  l = max(l, line(abs(ay.sub(single)), h, w).mul(step(ax, d.x)));
  l = max(l, line(abs(ax.sub(service)), h, w).mul(step(ay, single)));
  l = max(l, line(ay, h, w).mul(step(ax, service)));
  return max(
    l,
    line(ay, h, w)
      .mul(step(d.x.sub(0.1), ax))
      .mul(step(ax, d.x))
  );
}

/** spBasketEnd: one basket end, e.x from the baseline inward, s the scale. */
function basketEnd(e: V2, s: F, h: F, w: F): F {
  let l = line(
    box(e.sub(vec2(s.mul(2.9), 0)), vec2(s.mul(2.9), s.mul(2.45))),
    h,
    w
  );
  l = max(
    l,
    line(abs(length(e.sub(vec2(s.mul(5.8), 0))).sub(s.mul(1.8))), h, w).mul(
      step(s.mul(5.8), e.x)
    )
  );
  const bend = s.mul(1.575 + THREE_BEND);
  const three = select(
    e.x.lessThan(bend),
    abs(abs(e.y).sub(s.mul(6.6))),
    abs(length(e.sub(vec2(s.mul(1.575), 0))).sub(s.mul(6.75)))
  );
  return max(l, line(three, h, w).mul(step(0, e.x)));
}

/** spBasketball: a full court, or (nearly square) a half court at −x. */
function basketball(q: V2, f: V2, h: F, w: F): F {
  const outline = line(box(q, f), h, w);
  const mask = step(box(q, f), h.add(w));
  const sHalf = fit(f.y.div(7.5), f.x.mul(2).div(14));
  const half = max(outline, basketEnd(vec2(q.x.add(f.x), q.y), sHalf, h, w));
  const s = fit(f.x.div(14), f.y.div(7.5));
  let full = max(outline, line(abs(q.x), h, w));
  full = max(full, line(abs(length(q).sub(s.mul(1.8))), h, w));
  full = max(full, basketEnd(vec2(f.x.sub(abs(q.x)), q.y), s, h, w));
  // Both are drawn and one picked: the half court's end is a few terms.
  return select(f.x.lessThan(f.y.mul(1.3)), half, full).mul(mask);
}

/** spVolleyball: FIVB lines; on sand, no attack lines. */
function volleyball(q: V2, f: V2, h: F, w: F, beach: B): F {
  const std = select(beach, vec2(8, 4), vec2(9, 4.5));
  const s = fit(f.x.div(std.x), f.y.div(std.y));
  const d = std.mul(s);
  const across = step(abs(q.y), d.y);
  const l = max(line(box(q, d), h, w), line(abs(q.x), h, w).mul(across));
  const attack = line(abs(abs(q.x).sub(s.mul(3))), h, w).mul(across);
  return select(beach, l, max(l, attack));
}

/** spCourt: outline, centre line and a goal area at each end. */
function court(q: V2, f: V2, h: F, w: F): F {
  const s = fit(f.x.div(20), f.y.div(10));
  let l = line(box(q, f), h, w);
  l = max(l, line(abs(q.x), h, w));
  const e = vec2(f.x.sub(abs(q.x)), max(abs(q.y).sub(s.mul(1.5)), 0));
  l = max(l, line(abs(length(e).sub(s.mul(6))), h, w));
  l = max(l, line(abs(length(q).sub(s.mul(3))), h, w));
  return l.mul(step(box(q, f), h.add(w)));
}

/** spLanes: running lanes, 1.22 m; t = the distance in from the outer edge. */
function lanes(t: F, bandW: F, h: F, w: F): F {
  const k = clamp(floor(t.div(1.22).add(0.5)), 0, floor(bandW.div(1.22)));
  return line(abs(t.sub(k.mul(1.22))), h, w).mul(step(t, bandW.add(h).add(w)));
}

/** spBoard: a chessboard's dark squares, faded out once they alias. */
function board(q: V2, f: V2, w: F): F {
  const side = min(f.x, f.y).mul(2).div(8);
  const c = floor(q.div(side));
  const inside = step(box(q, vec2(side.mul(4), side.mul(4))), 0);
  const dark = mod(c.x.add(c.y), 2);
  return dark.mul(inside).mul(float(1).sub(smoothstep(0.1, 0.4, w.div(side))));
}

/** The four texels around the fragment (spT) and the bilinear weight. */
interface Around {
  f: V2;
  t: V3[];
}

/** The best row so far: its depth, frame and parameters (vars). */
interface Best {
  prm: V4;
  q: V2;
  sd: F;
}

/** The outline's signed distance for one row (stadium, free or rect). */
function outline(
  row: F,
  q: V2,
  b: V4,
  shape: F,
  near: Around & { mpt: number }
): F {
  const c = length(vec2(max(abs(q.x).sub(b.x), 0), q.y)).sub(b.y);
  const stadium = max(c, c.negate().sub(bandWidth(b.xyz)));
  const bit = (t: V3): F =>
    select(t.x.equal(row).and(t.z.greaterThan(0.5)), float(1), float(0));
  const [t0, t1, t2, t3] = near.t;
  const cov = mix(
    mix(bit(t0), bit(t1), near.f.x),
    mix(bit(t2), bit(t3), near.f.x),
    near.f.y
  );
  const free = float(0.5).sub(cov).mul(near.mpt);
  return select(
    shape.equal(SHAPE.stadium),
    stadium,
    select(shape.equal(SHAPE.free), free, box(q, b.xy))
  );
}

/** One pass of the row search: read the row, keep it if it is deeper. */
function tryRow(
  row: F,
  table: Texture,
  local: V2,
  near: Around & { mpt: number },
  best: Best
): void {
  const at = ivec2(int(row.sub(1)), 0);
  const a = textureLoad(table, at).toVar();
  const b = textureLoad(table, at.add(ivec2(0, 1))).toVar();
  const d = local.sub(a.xy);
  const q = vec2(dot(d, a.zw), dot(d, vec2(a.w.negate(), a.z))).toVar();
  const shape = floor(floor(b.w.add(0.5)).div(64));
  const sd = outline(row, q, b, shape, near).toVar();
  If(sd.lessThan(best.sd), () => {
    best.sd.assign(sd);
    best.q.assign(q);
    best.prm.assign(b);
  });
}

/** The row search: the rows of the four texels, then their second rows. */
function findGround(
  g: GroundInputs,
  table: Texture,
  near: Around & { mpt: number }
): Best {
  const local = vec2(g.uv.x.mul(g.size[0]), g.uv.y.mul(g.size[1]).negate());
  const best: Best = {
    sd: float(1e3).toVar(),
    q: vec2(0).toVar(),
    prm: vec4(0).toVar(),
  };
  const rows = [...near.t.map((t) => t.x), ...near.t.map((t) => t.y)];
  for (const [k, row] of rows.entries()) {
    // Skip an empty texel and a row equal to the one just tried.
    let fresh: B = row.greaterThanEqual(0.5);
    if (k > 0) {
      fresh = fresh.and(row.notEqual(rows[k - 1]));
    }
    If(fresh, () => {
      tryRow(row, table, local, near, best);
    });
  }
  return best;
}

/** The playing surface: palette colour, mown stripes and grain. */
function surface(
  g: GroundInputs,
  fd: Fields,
  m: MeadowVars,
  best: Best,
  surf: F
): V3 {
  let col: V3 = vec3(PALETTE[0], PALETTE[1], PALETTE[2]);
  for (let i = 1; i * 3 < PALETTE.length; i++) {
    const rgb = vec3(PALETTE[i * 3], PALETTE[i * 3 + 1], PALETTE[i * 3 + 2]);
    col = select(surf.equal(i), rgb, col);
  }
  const tex = live(g.groundDetail);
  const grain = noise(g.xy.mul(2.3))
    .mul(0.6)
    .add(noise(g.xy.mul(0.45).add(7)).mul(0.4));
  const grass = surf.equal(SURF.grass);
  const grassy = grass.or(surf.equal(SURF.turf));
  // Mown stripes across the long axis, ~5.5 m, whole stripes to a pitch;
  // broad enough to hold from the air.
  const count = max(2, floor(best.prm.x.div(5.5).add(0.5)).mul(2));
  const sw = best.prm.x.mul(2).div(count);
  const t = abs(fract(best.q.x.div(sw)).sub(0.5)).mul(2);
  const aa = min(fd.w.div(sw).mul(2), 0.5);
  const stripe = smoothstep(float(0.5).sub(aa), aa.add(0.5), t);
  const depth = select(grass, float(0.045), float(0.025));
  const mown = stripe
    .sub(0.5)
    .mul(2)
    .mul(depth)
    .mul(tex)
    .mul(float(1).sub(smoothstep(0.8, 2.5, m.fw)))
    .add(1);
  const amount = select(
    grassy,
    float(0.05),
    select(surf.equal(SURF.sand), float(0.09), float(0.04))
  );
  const grained = grain.sub(0.5).mul(amount).mul(fd.mid).mul(tex).add(1);
  return col.mul(select(grassy, mown, float(1))).mul(grained);
}

/** The line scheme of the ground (spL); a board darkens baseCol itself. */
function markings(
  best: Best,
  codes: { mark: F; shape: F; surf: F },
  w: F,
  shade: { baseCol: V3; spIn: F }
): F {
  const { prm, q } = best;
  const h = float(0.06);
  const hc = h.mul(0.85);
  const f = prm.xy.sub(clamp(prm.y.mul(0.03), 0.3, 1.5));
  const l = float(0).toVar();
  const isMark = (k: number) => codes.mark.equal(k);
  If(codes.shape.equal(SHAPE.stadium), () => {
    If(isMark(MARK.lanes), () => {
      const c = length(vec2(max(abs(q.x).sub(prm.x), 0), q.y)).sub(prm.y);
      const bw = bandWidth(prm.xyz);
      const lane = lanes(c.negate().sub(0.05), bw.sub(0.1), h, w);
      // The finish line across the lanes, where the home straight ends.
      const finish = line(abs(q.x.sub(prm.x)), h, w)
        .mul(step(q.y, 0))
        .mul(step(c.negate(), bw));
      l.assign(max(lane, finish));
    });
  }).ElseIf(codes.shape.equal(SHAPE.rect), () => {
    // Block bodies: an If whose branch returns a node becomes an
    // expression in TSL (the last branch here returns none: a void var).
    If(isMark(MARK.football), () => {
      l.assign(football(q, f, h, w));
    })
      .ElseIf(isMark(MARK.tennis), () => {
        l.assign(tennis(q, prm.xy.sub(0.3), hc, w));
      })
      .ElseIf(isMark(MARK.basketball), () => {
        l.assign(basketball(q, f, hc, w));
      })
      .ElseIf(isMark(MARK.volleyball), () => {
        l.assign(volleyball(q, f, hc, w, codes.surf.equal(SURF.sand)));
      })
      .ElseIf(isMark(MARK.court), () => {
        l.assign(court(q, f, hc, w));
      })
      .ElseIf(isMark(MARK.lanes), () => {
        l.assign(lanes(q.y.add(prm.y).sub(0.3), prm.y.mul(2).sub(0.6), h, w));
      })
      .ElseIf(isMark(MARK.board), () => {
        const dark = board(q, prm.xy.sub(0.5), w);
        shade.baseCol.mulAssign(float(1).sub(dark.mul(0.3).mul(shade.spIn)));
      });
  });
  return l;
}

/**
 * Paints the sports grounds into `baseCol` (a vec3 var, updated in place with
 * .assign) and clears the meadow vars `m.meadow` / `m.detail` under a painted
 * surface (they are vars; update with .assign / mulAssign), exactly as
 * SPORT_GROUND does. Call inside the terrain's colour Fn after the ground
 * detail (groundDetail) and before the NDVI tint.
 */
export function sportGround(
  g: GroundInputs,
  fd: Fields,
  m: MeadowVars,
  baseCol: Node<"vec3">,
  sport: { raster: Texture; table: Texture }
): void {
  const [sw, sh] = texSize(sport.raster);
  const at = rasterReader(sport.raster);
  const p = g.uv.mul(vec2(sw, sh)).sub(0.5);
  const i = ivec2(floor(p)).toVar();
  const t = [
    at(i).toVar(),
    at(i.add(ivec2(1, 0))).toVar(),
    at(i.add(ivec2(0, 1))).toVar(),
    at(i.add(ivec2(1, 1))).toVar(),
  ];
  const near = { f: fract(p).toVar(), t, mpt: g.size[0] / sw };
  const any = t
    .map((c) => c.x.add(c.y))
    .reduce((s, x) => s.add(x))
    .greaterThan(0.5);
  If(any, () => {
    const best = findGround(g, sport.table, near);
    const code = floor(best.prm.w.add(0.5));
    const codes = {
      surf: mod(code, 8).toVar(),
      mark: mod(floor(code.div(8)), 8).toVar(),
      shape: floor(code.div(64)).toVar(),
    };
    const spIn = float(1)
      .sub(smoothstep(fd.w.negate(), fd.w, best.sd))
      .toVar();
    If(codes.surf.greaterThan(0.5).and(spIn.greaterThan(0)), () => {
      const col = surface(g, fd, m, best, codes.surf);
      baseCol.assign(mix(baseCol, col, spIn));
      // A painted ground is not meadow: no NDVI drift, no grass break-up.
      m.meadow.mulAssign(float(1).sub(spIn));
      m.detail.mulAssign(float(1).sub(spIn));
    });
    const w = max(fd.w, 0.004);
    const l = markings(best, codes, w, { baseCol, spIn });
    // Warm white chalk; on sand, the blue of beach-volleyball tape.
    const ink = select(
      codes.surf.equal(SURF.sand),
      vec3(0.2, 0.33, 0.55),
      vec3(0.86, 0.84, 0.78)
    );
    const fade = float(1).sub(smoothstep(0.6, 1.6, m.fw));
    baseCol.assign(
      mix(baseCol, ink, clamp(l, 0, 1).mul(spIn).mul(fade).mul(0.9))
    );
  });
}
