import type { Node } from "three/webgpu";
import {
  abs,
  and,
  clamp,
  cos,
  dot,
  float,
  floor,
  Fn,
  If,
  int,
  ivec2,
  max,
  min,
  mix,
  select,
  sin,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import {
  LANE_BITS,
  MARKING_OFFSET_SCALE,
  MARKING_PATTERN as P,
  markingKindId,
} from "@/lib/city/markings";
import type { F, I, Tex, V2, V3 } from "./shader-chunks";
import {
  gdBand,
  gdNoise,
  GROUND_DETAIL,
  type GroundColour,
  type GroundFields,
  type GroundInputs,
  loadTexel,
  parkingBandOf,
  texelAt,
  texelSize,
} from "./ground-detail";
import { spLine } from "./sport-ground";

/**
 * Road markings in the terrain's colour node (pipeline/bake/markings.py,
 * lib/city/markings.ts, plan 026), after the sports grounds: paint, no
 * geometry.
 *
 * - **Crossings and stop lines** come from a table of rotated rectangles
 *   (axis across the road); the index raster names the rows whose outline,
 *   grown by 1 m, reaches a texel. A zebra (only where OSM says zebra) is
 *   0.5 m bars across the whole crossing, a *Furt* (a signalled crossing,
 *   or one OSM says has lines) two broken 12 cm lines along its edges, a
 *   stop line one 0.5 m bar.
 * - **Cycle lanes**: on the side of the way the raster's bit says, a
 *   Radfahrstreifen's solid 25 cm line 1.85 m from the kerb (the baked kerb
 *   distance) or a Schutzstreifen's 12 cm dashes at 1.5 m (2.25 m where
 *   tagged wide), past a parking lane on that side; red between the kerb
 *   (or the parking) and the line where OSM says red. A red cycle track
 *   mapped on its own is red where the raster's red bit is.
 * - **Centre lines**: 12 cm dashes (3 m in 8.25 m), or a solid line where
 *   overtaking is forbidden, where the baked signed distance to the
 *   carriageway's middle crosses zero; with four lanes or more dashed lane
 *   lines halfway to each kerb too. None on a tram's tracks (the bake).
 *
 * Every line is box-filtered over the pixel footprint (`rmLine`,
 * `rmStripes` — the exact coverage, so a zebra far off averages to a pale
 * band instead of shimmering), clipped to the carriageway by the kerb
 * distance, worn by a low-frequency mottle, and scaled by *Bodendetail*
 * (0 = no paint). Reads the ground fields (ground-detail.ts).
 */

const ZEBRA = markingKindId("zebra");
const FURT = markingKindId("furt");
const STOP = markingKindId("stop");

/** Coverage of |d| < hw over the footprint [d − w, d + w] (as `spLine`). */
const rmLine = spLine;

/** Coverage of stripes [k p, k p + a) up to t: whole stripes and the part
 *  of the current one. */
function rmCum(t: F, a: F, p: F): F {
  const k = floor(t.div(p));
  return k.mul(a).add(min(t.sub(k.mul(p)), a));
}

/** Coverage of stripes [k p, k p + a) over [x − w, x + w], exactly. */
export const rmStripes = Fn(
  ([x, a, p, w]: [F, F, F, F]): F =>
    rmCum(x.add(w), a, p)
      .sub(rmCum(x.sub(w), a, p))
      .div(w.mul(2)),
  { x: "float", a: "float", p: "float", w: "float", return: "float" }
);

/** The raster's bytes at a texel: row (R + 256 A, 1-based), bits, offset. */
function rmAt(raster: Tex, p: Node<"ivec2">, size: Node<"ivec2">): V3 {
  const t = floor(texelAt(raster, p, size).mul(255).add(0.5));
  return vec3(t.x.add(t.w.mul(256)), t.y, t.z);
}

/** One table row's paint at the local position (m from the tile's NW
 *  corner). */
function rmRow(table: Tex, row: F, local: V2, w: F): F {
  const at = int(row).sub(1);
  const a = loadTexel(table, ivec2(at, 0));
  const b = loadTexel(table, ivec2(at, 1));
  const d = local.sub(a.xy);
  // q.x across the road (the way a pedestrian walks), q.y along it
  const q = vec2(dot(d, a.zw), dot(d, vec2(a.w.negate(), a.z)));
  const kind = int(b.z.add(0.5));
  const across = rmLine(q.x, b.x, w);
  const bars = q.x.add(b.x);
  const zebra = across
    .mul(rmLine(q.y, b.y, w))
    .mul(rmStripes(bars, P.zebraBar, P.zebraPeriod, w));
  const furt = across
    .mul(rmLine(abs(q.y).sub(b.y), P.furtHalfWidth, w))
    .mul(rmStripes(bars, P.furtDash, P.furtPeriod, w));
  const stop = across.mul(rmLine(q.y, b.y, w));
  return select(
    kind.equal(ZEBRA),
    zebra,
    select(kind.equal(FURT), furt, select(kind.equal(STOP), stop, 0))
  );
}

/** A linear red for cycle surfaces (OSM `surface:colour=red`), muted to
 *  the palette: a brick red, not a signal red. */
const CYCLE_RED = vec3(0.42, 0.16, 0.13);

/** 1 where any of the four texels' G byte has the bit, bilinear. */
function bitCoverage(t: V3[], f: V2, bit: number): F {
  const on = (k: number): F =>
    select(int(t[k].y).bitAnd(bit).notEqual(0), 1, 0);
  return mix(mix(on(0), on(1), f.x), mix(on(2), on(3), f.x), f.y);
}

/**
 * The cycle lane on this texel's side: its line at its kind's distance
 * from the kerb, past a parking lane on that side (`cycleLineFromKerb`),
 * solid for a Radfahrstreifen, dashed for a Schutzstreifen; and where its
 * surface is red, the lane between the kerb (or the parking) and the line.
 * Returns the red's weight.
 */
function cycleLane(g: GroundFields, bits: I, along: F, w: F, paint: F): F {
  const solid = bits.bitAnd(LANE_BITS.cycleSolid).notEqual(0);
  const from = select(
    bits.bitAnd(LANE_BITS.cycleWide).notEqual(0),
    P.cycleWideFromKerb,
    select(solid, P.cycleFromKerb, P.cycleAdvisoryFromKerb)
  );
  const band = parkingBandOf(g);
  const shift = select(band.street, max(band.to, 0), 0).toVar();
  const at = from.add(shift).toVar();
  const half = select(solid, P.cycleHalfWidth, P.cycleAdvisoryHalfWidth);
  const line = rmLine(g.dr.sub(at), half, w);
  const dash = select(
    solid,
    float(1),
    rmStripes(along, P.cyclePeriod / 2, P.cyclePeriod, w)
  );
  paint.assign(max(paint, line.mul(dash)));
  const red = select(bits.bitAnd(LANE_BITS.red).notEqual(0), 1, 0);
  return gdBand(g.dr, shift, at, w).mul(red);
}

/**
 * The centre line where the baked signed distance to the carriageway's
 * middle crosses zero — dashed, or solid where overtaking is forbidden —
 * and with four lanes or more the dashed lane lines halfway to each kerb
 * (where |s| equals the kerb distance).
 */
function centreLines(t: V3[], f: V2, all: I, along: F, w: F, dr: F): F {
  const s = mix(mix(t[0].z, t[1].z, f.x), mix(t[2].z, t[3].z, f.x), f.y)
    .sub(128)
    .div(MARKING_OFFSET_SCALE)
    .toVar();
  const dashes = rmStripes(along, P.centreDash, P.centrePeriod, w).toVar();
  const solid = all.bitAnd(LANE_BITS.centreSolid).notEqual(0);
  const middle = rmLine(s, P.centreHalfWidth, w).mul(
    select(solid, float(1), dashes)
  );
  // |s| − dr changes by 2 per metre across the road: halved, in metres
  const lanes = rmLine(abs(s).sub(dr).mul(0.5), P.centreHalfWidth, w)
    .mul(dashes)
    .mul(select(all.bitAnd(LANE_BITS.laneLines).notEqual(0), 1, 0));
  return max(middle, lanes);
}

/** Cycle and centre lines along the carriageway (the baked kerb distance);
 *  on a cycle lane `red` becomes its red fill's weight. */
function laneLines(
  inp: GroundInputs,
  g: GroundFields,
  t: V3[],
  f: V2,
  w: F,
  paint: F,
  red: F
): void {
  If(g.dr.greaterThan(0), () => {
    // along the street: the paving raster's frame, else the bearing's
    const dir = vec2(cos(g.head), sin(g.head));
    const along = select(g.hasFrame, g.alongM, dot(inp.xy, dir)).toVar();
    const nearest = select(
      f.x.lessThan(0.5),
      select(f.y.lessThan(0.5), t[0], t[2]),
      select(f.y.lessThan(0.5), t[1], t[3])
    );
    const bits = int(nearest.y).toVar();
    If(bits.bitAnd(LANE_BITS.cycle).notEqual(0), () => {
      red.assign(cycleLane(g, bits, along, w, paint));
    });
    const all = int(t[0].y)
      .bitAnd(int(t[1].y))
      .bitAnd(int(t[2].y))
      .bitAnd(int(t[3].y))
      .toVar();
    If(all.bitAnd(LANE_BITS.centre).notEqual(0), () => {
      paint.assign(max(paint, centreLines(t, f, all, along, w, g.dr)));
    });
  });
}

/** The paint (after `sportGround`; reads the ground fields). */
export function roadMarkings(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  markings: { raster: Tex; table: Tex }
): void {
  If(and(GROUND_DETAIL.greaterThan(0), inp.fw.lessThan(1.5)), () => {
    const size = texelSize(markings.raster, inp.uv).toVar();
    const p = inp.uv.mul(vec2(size)).sub(0.5).toVar();
    const i = ivec2(floor(p)).toVar();
    const f = p.sub(floor(p)).toVar();
    const t = [
      rmAt(markings.raster, i, size).toVar(),
      rmAt(markings.raster, i.add(ivec2(1, 0)), size).toVar(),
      rmAt(markings.raster, i.add(ivec2(0, 1)), size).toVar(),
      rmAt(markings.raster, i.add(ivec2(1, 1)), size).toVar(),
    ];
    const w = max(g.w, 0.004).toVar();
    const paint = float(0).toVar();
    // crossings and stop lines: every distinct row among the four texels
    for (let k = 0; k < 4; k++) {
      let cond = t[k].x.greaterThan(0.5);
      for (let j = 0; j < k; j++) {
        cond = and(cond, t[k].x.notEqual(t[j].x));
      }
      If(cond, () => {
        paint.assign(max(paint, rmRow(markings.table, t[k].x, g.local, w)));
      });
    }
    // a red cycle surface: a lane's fill on the carriageway, else (a
    // track mapped on its own, a cycle crossing) the texels' coverage
    const red = bitCoverage(t, f, LANE_BITS.red).toVar();
    if (g.hasEdge) {
      laneLines(inp, g, t, f, w, paint, red);
    }
    // on the carriageway only (a crossing a little off the DLM road stops
    // at the kerb), worn, and gone before it could crawl in the distance
    const road = g.hasEdge ? smoothstep(w.negate(), w, g.dr) : float(1);
    const wear = gdNoise(inp.xy.mul(0.37).add(3)).mul(0.22).add(0.78);
    const fade = float(1).sub(smoothstep(0.5, 1.5, inp.fw));
    const on = min(GROUND_DETAIL.div(0.7), 1).mul(0.85);
    const mark = clamp(paint, 0, 1)
      .mul(road)
      .mul(wear)
      .mul(fade)
      .mul(on)
      .toVar();
    col.baseCol.assign(
      mix(col.baseCol, CYCLE_RED, red.mul(fade).mul(on).mul(0.8))
    );
    col.baseCol.assign(
      mix(col.baseCol, max(col.baseCol, vec3(0.88, 0.87, 0.83)), mark)
    );
    col.paperInk.assign(max(col.paperInk, mark));
  });
}
