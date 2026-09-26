import type { Texture } from "three";
import {
  abs,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  If,
  int,
  ivec2,
  max,
  min,
  mix,
  mod,
  select,
  sin,
  smoothstep,
  textureLoad,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import {
  LANE_BITS,
  MARKING_OFFSET_SCALE,
  MARKING_PATTERN as P,
  markingKindId,
} from "@/lib/city/markings";
import {
  type Fields,
  type GroundInputs,
  type MeadowVars,
  noise,
} from "./ground-detail-node";

/**
 * SPIKE (plan 020): road-markings.ts in TSL — crossings, stop lines, cycle
 * lanes and centre lines — term for term; the GLSL is the source of truth.
 * The raster and the table are read with `textureLoad`, so nothing inside
 * the `If` takes an implicit derivative; the lane bits are tested with
 * exact float arithmetic (the bytes are small integers).
 */

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;

const ZEBRA = markingKindId("zebra");
const FURT = markingKindId("furt");
const STOP = markingKindId("stop");

const texSize = (t: Texture): [number, number] => {
  const img = t.image as { height: number; width: number };
  return [img.width, img.height];
};

/** Bit `b` (a power of two) of the integer byte `v`, as 0/1 (`v & b`). */
const bit = (v: F, b: number): F => mod(floor(v.div(b)), 2);

/** rmLine: coverage of |d| < hw over the footprint [d − w, d + w]. */
function line(d: F, hw: F | number, w: F): F {
  const h = typeof hw === "number" ? float(hw) : hw;
  return max(0, min(d.add(w), h).sub(max(d.sub(w), h.negate()))).div(w.mul(2));
}

/** rmCum: the stripes' cumulative coverage up to t. */
function cum(t: F, a: number, p: number): F {
  const k = floor(t.div(p));
  return k.mul(a).add(min(t.sub(k.mul(p)), a));
}

/** rmStripes: coverage of stripes [k p, k p + a) over [x − w, x + w]. */
function stripes(x: F, a: number, p: number, w: F): F {
  return cum(x.add(w), a, p)
    .sub(cum(x.sub(w), a, p))
    .div(w.mul(2));
}

/** rmAt: the raster's bytes at a texel — row (R + 256 A), bits, offset. */
function rasterReader(raster: Texture) {
  const [sw, sh] = texSize(raster);
  const hi = ivec2(sw - 1, sh - 1);
  return (p: Node<"ivec2">): V3 => {
    const t = floor(
      textureLoad(
        raster,
        // reason: @types/three types clamp for float vectors; WGSL/GLSL
        // clamp takes ivec2 fine (as in ground-detail-node.ts).
        clamp(p as never, ivec2(0, 0) as never, hi as never)
      )
        .mul(255)
        .add(0.5)
    );
    return vec3(t.x.add(t.w.mul(256)), t.y, t.z).toVar();
  };
}

/** rmRow: one table row's paint at the local position (m from the NW corner). */
function rowPaint(table: Texture, row: F, local: V2, w: F): F {
  const col = int(row).sub(1);
  const a = textureLoad(table, ivec2(col, int(0))).toVar();
  const b = textureLoad(table, ivec2(col, int(1))).toVar();
  const d = local.sub(a.xy);
  // q.x across the road (the way a pedestrian walks), q.y along it
  const q = vec2(dot(d, a.zw), dot(d, vec2(a.w.negate(), a.z))).toVar();
  const kind = floor(b.z.add(0.5));
  const across = line(q.x, b.x, w);
  const zebra = across
    .mul(line(q.y, b.y, w))
    .mul(stripes(q.x.add(b.x), P.zebraBar, P.zebraPeriod, w));
  const edge = line(abs(q.y).sub(b.y), P.furtHalfWidth, w);
  const furt = across
    .mul(edge)
    .mul(stripes(q.x.add(b.x), P.furtDash, P.furtPeriod, w));
  const stop = across.mul(line(q.y, b.y, w));
  return select(
    kind.equal(ZEBRA),
    zebra,
    select(kind.equal(FURT), furt, select(kind.equal(STOP), stop, float(0)))
  );
}

interface Corners {
  f: V2;
  t: [V3, V3, V3, V3];
}

/** Crossings and stop lines: every distinct row among the four texels. */
function crossings(
  table: Texture,
  c: Corners,
  local: V2,
  w: F,
  paint: F
): void {
  const [t0, t1, t2, t3] = c.t;
  const add = (row: F) => () => {
    paint.assign(max(paint, rowPaint(table, row, local, w)));
  };
  If(t0.x.greaterThan(0.5), add(t0.x));
  If(t1.x.greaterThan(0.5).and(t1.x.notEqual(t0.x)), add(t1.x));
  If(
    t2.x.greaterThan(0.5).and(t2.x.notEqual(t0.x)).and(t2.x.notEqual(t1.x)),
    add(t2.x)
  );
  If(
    t3.x
      .greaterThan(0.5)
      .and(t3.x.notEqual(t0.x))
      .and(t3.x.notEqual(t1.x))
      .and(t3.x.notEqual(t2.x)),
    add(t3.x)
  );
}

/** Cycle lanes and centre lines, along the street (only with the edge raster). */
function laneLines(
  g: GroundInputs,
  fd: Fields,
  c: Corners,
  w: F,
  paint: F
): void {
  const [t0, t1, t2, t3] = c.t;
  const { f } = c;
  If(fd.dr.greaterThan(0), () => {
    // along the street: the paving raster's frame, else the bearing's
    const dir = vec2(cos(fd.head), sin(fd.head));
    const along = select(
      fd.hasFrame.greaterThan(0.5),
      fd.alongM,
      dot(g.xy, dir)
    ).toVar();
    const nearest = select(
      f.x.lessThan(0.5),
      select(f.y.lessThan(0.5), t0, t2),
      select(f.y.lessThan(0.5), t1, t3)
    );
    If(bit(nearest.y, LANE_BITS.cycle).greaterThan(0.5), () => {
      const l = line(fd.dr.sub(P.cycleFromKerb), P.cycleHalfWidth, w);
      paint.assign(
        max(paint, l.mul(stripes(along, P.cyclePeriod / 2, P.cyclePeriod, w)))
      );
    });
    const all = bit(t0.y, LANE_BITS.centre)
      .mul(bit(t1.y, LANE_BITS.centre))
      .mul(bit(t2.y, LANE_BITS.centre))
      .mul(bit(t3.y, LANE_BITS.centre));
    If(all.greaterThan(0.5), () => {
      const s = mix(mix(t0.z, t1.z, f.x), mix(t2.z, t3.z, f.x), f.y)
        .sub(128)
        .div(MARKING_OFFSET_SCALE);
      const l = line(s, P.centreHalfWidth, w);
      paint.assign(
        max(paint, l.mul(stripes(along, P.centreDash, P.centrePeriod, w)))
      );
    });
  });
}

/** Paints the road markings into baseCol (vec3 var, .assign), as ROAD_MARKINGS. Call after the sports grounds. */
export function roadMarkings(
  g: GroundInputs,
  fd: Fields,
  m: MeadowVars,
  baseCol: Node<"vec3">,
  markings: { raster: Texture; table: Texture }
): void {
  const on = uniform(g.groundDetail.value).onRenderUpdate(
    () => g.groundDetail.value
  );
  const at = rasterReader(markings.raster);
  const [sw, sh] = texSize(markings.raster);
  If(on.greaterThan(0).and(m.fw.lessThan(1.5)), () => {
    const p = g.uv.mul(vec2(sw, sh)).sub(0.5);
    const i = ivec2(floor(p)).toVar();
    const c: Corners = {
      f: fract(p).toVar(),
      t: [
        at(i),
        at(i.add(ivec2(1, 0))),
        at(i.add(ivec2(0, 1))),
        at(i.add(ivec2(1, 1))),
      ],
    };
    const w = max(fd.w, 0.004).toVar();
    const local = vec2(
      g.uv.x.mul(g.size[0]),
      g.uv.y.negate().mul(g.size[1])
    ).toVar();
    const paint = float(0).toVar();
    crossings(markings.table, c, local, w, paint);
    if (fd.hasEdge) {
      laneLines(g, fd, c, w, paint);
    }
    // on the carriageway only (a crossing a little off the DLM road stops
    // at the kerb), worn, and gone before it could crawl in the distance
    const road = fd.hasEdge ? smoothstep(w.negate(), w, fd.dr) : float(1);
    const wear = noise(g.xy.mul(0.37).add(3)).mul(0.22).add(0.78);
    const fade = float(1).sub(smoothstep(0.5, 1.5, m.fw));
    const strength = min(on.div(0.7), 1).mul(0.85);
    baseCol.assign(
      mix(
        baseCol,
        max(baseCol, vec3(0.88, 0.87, 0.83)),
        clamp(paint, 0, 1).mul(road).mul(wear).mul(fade).mul(strength)
      )
    );
  });
}
