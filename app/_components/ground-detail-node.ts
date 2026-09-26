import type { Texture, Vector3 } from "three";
import {
  abs,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  If,
  ivec2,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  select,
  sin,
  smoothstep,
  step,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { KERB_HEIGHT } from "@/lib/city/kerbs";
import {
  BUILTUP_CLASS,
  EDGE_SCALE,
  LANDCOVER_CLASSES,
  MEADOW_CLASS,
  PATH_CLASS,
  parkingId,
  ROAD_CLASS,
  SURFACE_ALONG_PERIOD,
  type SurfaceKind,
  srgbToLinear,
  surfaceId,
} from "@/lib/city/landcover";

/**
 * SPIKE (plan 020): ground-detail.ts in TSL — the kerb band and its sun
 * shadow, lawn edges, the paving patterns and parking lines, urban green —
 * term for term. The GLSL's `int` bookkeeping (class ids, the packed paving
 * byte) is carried in exact floats here; the class and paving rasters are
 * read with `textureLoad`, the edge raster at level 0, so no implicit
 * derivative is taken inside a branch. The one structural difference: the
 * box-smoothed class edge (no edge raster) is computed under the same
 * `If` as the GLSL, with the plain-texel distance as the default.
 */

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;
type Live = { value: number };

const live = (ref: Live) => uniform(ref.value).onRenderUpdate(() => ref.value);
const kindId = (kind: SurfaceKind) => surfaceId(kind);
const PI = Math.PI;

/** The meadow's and the road's palette colours, linear. */
export const MEADOW_LINEAR =
  LANDCOVER_CLASSES[MEADOW_CLASS].srgb.map(srgbToLinear);
const ROAD_LINEAR = LANDCOVER_CLASSES[ROAD_CLASS].srgb.map(srgbToLinear);

/** What the terrain material hands in. */
export interface GroundInputs {
  /** class-id raster (NEAREST) and its size in texels */
  classTexture: Texture;
  classSize: [number, number];
  edgesTexture?: Texture;
  groundDetail: Live;
  ndviTexture?: Texture;
  /** the splat's size (m) */
  size: [number, number];
  sunDirection: Vector3;
  surfaceTexture?: Texture;
  urbanGreen: Live;
  uv: V2;
  xy: V2;
}

/** The meadow terms GRASS_MOTTLE leaves behind (vars, updated in place). */
export interface MeadowVars {
  cls: F;
  detail: F;
  fw: F;
  meadow: F;
  mottle: F;
}

const eq = (a: F, k: number): F => float(1).sub(step(0.5, abs(a.sub(k))));
const texSize = (t: Texture): [number, number] => {
  const img = t.image as { height: number; width: number };
  return [img.width, img.height];
};

/** gdHash of ground-detail.ts. */
export function hash(p: V2): F {
  const a = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const b = a.add(dot(a, a.yzx.add(33.33)));
  return fract(b.x.add(b.y).mul(b.z));
}

/** gdNoise of ground-detail.ts. */
export function noise(p: V2): F {
  const i = floor(p);
  const f0 = fract(p);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  return mix(
    mix(hash(i), hash(i.add(vec2(1, 0))), f.x),
    mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), f.x),
    f.y
  );
}

/** 1 inside [a, b] (m), anti-aliased over w on either edge. */
function band(d: F, a: F | number, b: F | number, w: F): F {
  const lo = typeof a === "number" ? float(a) : a;
  const hi = typeof b === "number" ? float(b) : b;
  return smoothstep(lo.sub(w), lo.add(w), d).sub(
    smoothstep(hi.sub(w), hi.add(w), d)
  );
}

/** 1 on a joint of a (sx × sy) grid, joint width jw (m). */
function joint(q: V2, sx: number, sy: number, jw: number, w: F): F {
  const size = vec2(sx, sy);
  const e = abs(fract(q.div(size)).sub(0.5)).mul(size);
  const m = min(e.x, e.y);
  return float(1).sub(smoothstep(float(jw * 0.5).sub(w), w.add(jw * 0.5), m));
}

/** Bilinear 0/1 field and its data-frame gradient per metre (x; yz). */
function field(c: Node<"vec4">, f: V2, mpt: [number, number]): V3 {
  const v = mix(mix(c.x, c.y, f.x), mix(c.z, c.w, f.x), f.y);
  const gu = mix(c.y.sub(c.x), c.w.sub(c.z), f.y).div(mpt[0]);
  const gv = mix(c.z.sub(c.x), c.w.sub(c.y), f.x).div(mpt[1]);
  return vec3(v, gu, gv.negate());
}

/** Signed distance (m) to the field's 0.5 isoline, positive inside. */
function sd(fld: V3): F {
  const g = length(fld.yz);
  return select(
    g.greaterThan(1e-4),
    fld.x.sub(0.5).div(max(g, 1e-4)),
    select(fld.x.greaterThan(0.5), float(1e3), float(-1e3))
  );
}

/** A data-frame horizontal direction in view space (world = data (x, z, −y)). */
const toView = (d: V2): V3 =>
  cameraViewMatrix.mul(vec4(d.x, 0, d.y.negate(), 0)).xyz;

/** The ground fields (ground-detail.ts `groundFields`: gdW, gdDr, …). */
export interface Fields {
  alongM: F;
  cls: F;
  dl: F;
  dr: F;
  fine: F;
  hasEdge: boolean;
  hasFrame: F;
  head: F;
  intoRoad: V2;
  kerbOk: F;
  kind: F;
  mid: F;
  near: F;
  onRoad: F;
  outOfLawn: V2;
  park: F;
  w: F;
  walkKind: F;
}

function classReader(g: GroundInputs) {
  const [cw, ch] = g.classSize;
  const hi = ivec2(cw - 1, ch - 1);
  return (p: Node<"ivec2">): F =>
    floor(
      textureLoad(
        g.classTexture,
        // reason: @types/three types clamp for float vectors; WGSL/GLSL
        // clamp takes ivec2 fine (as in landcover-splat.ts).
        clamp(p as never, ivec2(0, 0) as never, hi as never)
      )
        .r.mul(255)
        .add(0.5)
    );
}

/** The 4×4 box-smoothed road and lawn fields (gdSmooth). */
function smoothFields(
  classAt: (p: Node<"ivec2">) => F,
  i: Node<"ivec2">,
  f: V2,
  mpt: [number, number]
): { lawn: V3; road: V3 } {
  const r: F[] = [];
  const m: F[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const c = classAt(i.add(ivec2(x - 1, y - 1))).toVar();
      r.push(eq(c, ROAD_CLASS));
      m.push(eq(c, MEADOW_CLASS));
    }
  }
  const corner = (arr: F[], k: number): F => {
    const cx = 1 + (k & 1);
    const cy = 1 + (k >> 1);
    let s: F = float(0);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        s = s.add(arr[(cy + dy) * 4 + cx + dx]);
      }
    }
    return s.div(9);
  };
  const vec = (arr: F[]) =>
    vec4(corner(arr, 0), corner(arr, 1), corner(arr, 2), corner(arr, 3));
  return { road: field(vec(r), f, mpt), lawn: field(vec(m), f, mpt) };
}

interface Distances {
  dl: F;
  dr: F;
  intoRoad: V2;
  outOfLawn: V2;
}

/** The baked edge distances, valid out to ±6 m (edges.py). */
function bakedDistances(g: GroundInputs, edges: Texture): Distances {
  const [ew, eh] = texSize(edges);
  const at = (uv: V2): V2 =>
    texture(edges, uv).level(float(0)).rg.mul(255).sub(128).div(EDGE_SCALE);
  const ox = vec2(1 / ew, 0);
  const oy = vec2(0, 1 / eh);
  const e = at(g.uv).toVar();
  const ex = at(g.uv.add(ox))
    .sub(at(g.uv.sub(ox)))
    .toVar();
  const ey = at(g.uv.sub(oy))
    .sub(at(g.uv.add(oy)))
    .toVar();
  return {
    dr: e.x,
    dl: e.y,
    intoRoad: normalize(vec2(ex.x, ey.x).add(1e-6)).toVar(),
    outOfLawn: normalize(vec2(ex.y, ey.y).add(1e-6)).negate().toVar(),
  };
}

/** No baked distances: the class texels, box-smoothed near the camera. */
function texelDistances(
  g: GroundInputs,
  classAt: (p: Node<"ivec2">) => F,
  grid: { f: V2; i: Node<"ivec2">; lawn: V3; mpt: [number, number]; road: V3 },
  fw: F,
  on: F
): Distances {
  const dr = sd(grid.road).toVar();
  const dl = sd(grid.lawn).toVar();
  const intoRoad = vec2(1, 0).toVar();
  const outOfLawn = vec2(1, 0).toVar();
  If(fw.lessThan(0.5).and(on.greaterThan(0)), () => {
    const s = smoothFields(classAt, grid.i, grid.f, grid.mpt);
    dr.assign(sd(s.road));
    dl.assign(sd(s.lawn));
    intoRoad.assign(normalize(s.road.yz.add(1e-6)));
    outOfLawn.assign(normalize(s.lawn.yz.add(1e-6)).negate());
  });
  return { dr, dl, intoRoad, outOfLawn };
}

interface Paving {
  alongM: F;
  hasFrame: F;
  head: F;
  park: F;
  roadKind: F;
  walkKind: F;
}

/** The OSM paving raster: kinds, parking and the street's frame. */
function paving(g: GroundInputs): Paving {
  const surface = g.surfaceTexture;
  if (!surface) {
    const zero = float(0);
    return {
      alongM: zero,
      hasFrame: zero,
      head: zero,
      park: zero,
      roadKind: zero,
      walkKind: zero,
    };
  }
  const [sw, sh] = texSize(surface);
  const at = ivec2(g.uv.mul(vec2(sw, sh)));
  const s = textureLoad(
    surface,
    // reason: see classReader.
    clamp(at as never, ivec2(0, 0) as never, ivec2(sw - 1, sh - 1) as never)
  ).toVar();
  const byte = floor(s.r.mul(255).add(0.5));
  const gByte = floor(s.g.mul(255).add(0.5));
  const hasFrame = step(0.5, gByte);
  const head = gByte
    .sub(1)
    .div(254)
    .mul(2 * PI)
    .mul(hasFrame)
    .toVar();
  const offset = floor(s.b.mul(255).add(0.5))
    .add(floor(s.a.mul(255).add(0.5)).mul(256))
    .div(65_536)
    .mul(SURFACE_ALONG_PERIOD);
  const local = vec2(g.uv.x.mul(g.size[0]), g.uv.y.mul(g.size[1]).negate());
  const alongM = mod(
    offset.add(dot(local, vec2(cos(head), sin(head)))),
    SURFACE_ALONG_PERIOD
  );
  return {
    alongM: alongM.toVar(),
    hasFrame,
    head,
    park: floor(byte.div(64)).toVar(),
    roadKind: mod(byte, 8).toVar(),
    walkKind: mod(floor(byte.div(8)), 8).toVar(),
  };
}

/** The paving kind under the fragment (gdKind). */
function kindOf(cls: F, onRoad: F, p: Paving): F {
  const or = (k: F, fallback: number): F =>
    select(k.greaterThan(0), k, float(fallback));
  return select(
    onRoad.greaterThan(0.5),
    or(p.roadKind, kindId("asphalt")),
    select(
      eq(cls, BUILTUP_CLASS).greaterThan(0.5),
      or(p.walkKind, kindId("paving")),
      select(
        eq(cls, PATH_CLASS).greaterThan(0.5),
        or(p.walkKind, kindId("unpaved")),
        select(eq(cls, 0).greaterThan(0.5), p.walkKind, float(0))
      )
    )
  ).toVar();
}

/** groundFields: the distances, the paving kind and the street frame. */
export function groundFields(g: GroundInputs, m: MeadowVars): Fields {
  const classAt = classReader(g);
  const [cw, ch] = g.classSize;
  const mpt: [number, number] = [g.size[0] / cw, g.size[1] / ch];
  const p = g.uv.mul(vec2(cw, ch)).sub(0.5);
  const i = ivec2(floor(p)).toVar();
  const f = fract(p).toVar();
  const c00 = classAt(i).toVar();
  const c10 = classAt(i.add(ivec2(1, 0))).toVar();
  const c01 = classAt(i.add(ivec2(0, 1))).toVar();
  const c11 = classAt(i.add(ivec2(1, 1))).toVar();
  const of = (k: (c: F) => F) => vec4(k(c00), k(c10), k(c01), k(c11));
  const road = field(
    of((c) => eq(c, ROAD_CLASS)),
    f,
    mpt
  );
  const lawn = field(
    of((c) => eq(c, MEADOW_CLASS)),
    f,
    mpt
  );
  const on = live(g.groundDetail);
  const d = g.edgesTexture
    ? bakedDistances(g, g.edgesTexture)
    : texelDistances(g, classAt, { f, i, lawn, mpt, road }, m.fw, on);
  const kerbable = (c: F): F =>
    max(float(1).sub(step(BUILTUP_CLASS + 0.5, c)), eq(c, PATH_CLASS));
  const kerbOk = field(of(kerbable), f, mpt).x.toVar();
  const pav = paving(g);
  const onRoad = select(d.dr.greaterThan(0), float(1), float(0)).toVar();
  return {
    ...d,
    alongM: pav.alongM,
    cls: m.cls,
    fine: float(1)
      .sub(smoothstep(0.012, 0.05, m.fw))
      .toVar(),
    hasEdge: g.edgesTexture !== undefined,
    hasFrame: pav.hasFrame,
    head: pav.head,
    kerbOk,
    kind: kindOf(m.cls, onRoad, pav),
    mid: float(1)
      .sub(smoothstep(0.05, 0.35, m.fw))
      .toVar(),
    near: float(1)
      .sub(smoothstep(0.12, 0.5, m.fw))
      .toVar(),
    onRoad,
    park: pav.park,
    w: max(m.fw, 0.002).toVar(),
    walkKind: pav.walkKind,
  };
}

/**
 * Urban green: built-up or unclassified ground that is green, painted as
 * meadow. Returns `ugW`; updates the base colour and the meadow vars.
 */
export function urbanGreen(
  g: GroundInputs,
  fd: Fields,
  m: MeadowVars,
  baseCol: V3
): F {
  const built = max(eq(fd.cls, BUILTUP_CLASS), eq(fd.cls, 0));
  let mask: F = float(0);
  if (g.edgesTexture) {
    mask = smoothstep(-0.15, 0.15, fd.dl).mul(built);
  } else if (g.ndviTexture) {
    const sett = kindId("sett");
    const paved = step(0.5, fd.walkKind).mul(
      float(1).sub(step(sett + 0.5, fd.walkKind))
    );
    mask = smoothstep(0.22, 0.34, texture(g.ndviTexture, g.uv).bias(float(1)).r)
      .mul(built)
      .mul(float(1).sub(paved))
      .mul(float(1).sub(fd.onRoad));
  }
  const strength =
    g.ndviTexture || g.edgesTexture ? live(g.urbanGreen) : float(0);
  const ugW = mask.mul(strength).toVar();
  baseCol.assign(
    mix(baseCol, vec3(...MEADOW_LINEAR).mul(m.mottle.mul(0.035).add(1)), ugW)
  );
  m.meadow.assign(max(m.meadow, ugW));
  m.detail.assign(
    max(m.detail, ugW.mul(float(1).sub(smoothstep(0.5, 2.5, m.fw))))
  );
  return ugW;
}

/** The kerb band, its gutter and the kerb's shadow drawn from the sun. */
function kerb(g: GroundInputs, fd: Fields, on: F, baseCol: V3): void {
  const sun = uniform(g.sunDirection).onRenderUpdate(() => g.sunDirection);
  const k = smoothstep(0.15, 0.35, fd.kerbOk).mul(fd.near).mul(on);
  const top = band(fd.dr, -0.25, 0, fd.w);
  const gutter = band(fd.dr, 0, 0.35, fd.w);
  baseCol.assign(
    mix(
      baseCol,
      max(baseCol.mul(1.08), vec3(0.78, 0.76, 0.72)),
      top.mul(k).mul(0.8)
    )
  );
  baseCol.mulAssign(
    float(1)
      .sub(gutter.mul(k).mul(0.14))
      .sub(band(fd.dr, 0, 0.08, fd.w).mul(k).mul(0.08))
  );
  const sunH = vec2(sun.x, sun.z.negate());
  const behind = max(dot(sunH, fd.intoRoad).negate(), 0);
  const reach = min(behind.mul(KERB_HEIGHT).div(max(sun.y, 0.05)), 1.5);
  const cast = band(fd.dr, -0.01, reach, max(fd.w, 0.02)).mul(
    step(0.02, sun.y)
  );
  baseCol.mulAssign(float(1).sub(cast.mul(k).mul(0.28)));
}

/** The street's frame: q.x along it, q.y across (gdQ). */
function streetFrame(fd: Fields, xy: V2): V2 {
  const step5 = PI / 36;
  const hq = floor(fd.head.div(step5).add(0.5)).mul(step5);
  const a = vec2(cos(hq), sin(hq));
  const qx = mix(dot(xy, a), fd.alongM, fd.hasFrame);
  let qy: F = dot(xy, vec2(a.y.negate(), a.x));
  if (fd.hasEdge) {
    qy = select(abs(fd.dr).lessThan(6), fd.dr, qy);
  }
  return vec2(qx, qy).toVar();
}

/** The per-material patterns (asphalt, concrete, slabs, sett, …). */
function patterns(fd: Fields, xy: V2, q: V2, pave: F, baseCol: V3): void {
  const is = (kind: SurfaceKind) => fd.kind.equal(kindId(kind));
  If(is("asphalt"), () => {
    const n = noise(xy.mul(1.7))
      .mul(0.6)
      .add(noise(xy.mul(0.31)).mul(0.4));
    baseCol.mulAssign(
      float(1)
        .sub(pave.mul(0.03))
        .mul(n.sub(0.5).mul(0.08).mul(fd.mid).mul(pave).add(1))
    );
  })
    .ElseIf(is("concrete"), () => {
      const j = joint(q, 5.5, 3, 0.015, fd.w);
      const h = hash(floor(q.div(vec2(5.5, 3)).add(0.5)));
      baseCol.mulAssign(
        pave
          .mul(0.03)
          .add(1)
          .mul(h.sub(0.5).mul(0.05).mul(fd.mid).mul(pave).add(1))
          .mul(float(1).sub(j.mul(0.14).mul(fd.fine).mul(pave)))
      );
    })
    .ElseIf(is("paving"), () => {
      const size = vec2(0.5, 0.35);
      const row = floor(q.y.div(0.35).add(0.5));
      const qb = q.add(vec2(fract(row.mul(0.5)).mul(0.5), 0));
      const j = joint(qb, 0.5, 0.35, 0.01, fd.w);
      const h = hash(floor(qb.div(size).add(0.5)));
      baseCol.mulAssign(
        h
          .sub(0.5)
          .mul(0.04)
          .mul(fd.fine)
          .mul(pave)
          .add(1)
          .mul(float(1).sub(j.mul(0.09).mul(fd.fine).mul(pave)))
      );
    })
    .ElseIf(is("sett"), () => {
      const n = noise(xy.div(0.16))
        .mul(0.65)
        .add(noise(xy.div(0.5).add(17)).mul(0.35));
      baseCol.mulAssign(
        mix(vec3(1), vec3(0.95, 0.94, 0.93), pave).mul(
          n.sub(0.5).mul(0.07).mul(fd.fine).mul(pave).add(1)
        )
      );
    })
    .ElseIf(is("unpaved"), () => {
      const n = noise(xy.mul(3.1))
        .mul(0.5)
        .add(noise(xy.mul(0.7)).mul(0.5));
      baseCol.mulAssign(
        mix(vec3(1), vec3(1.03, 1, 0.92), pave).mul(
          n.sub(0.5).mul(0.1).mul(fd.mid).mul(pave).add(1)
        )
      );
    })
    .ElseIf(is("grass"), () => {
      const size = vec2(0.55, 0.4);
      const cell = abs(q.div(size).sub(floor(q.div(size).add(0.5))));
      const hole = float(1).sub(smoothstep(0.28, 0.32, max(cell.x, cell.y)));
      const green = mix(0.3, hole.mul(0.8), fd.fine);
      baseCol.assign(mix(baseCol, vec3(...MEADOW_LINEAR), green.mul(pave)));
    });
}

/** Bay lines laid out from the kerb, or across a car park. */
function parking(fd: Fields, q: V2, on: F, baseCol: V3, fw: F): void {
  const line = 0.07;
  const paint = float(0).toVar();
  const lineAt = (period: number) => {
    const e = abs(fract(q.x.div(period).add(0.5)).sub(0.5)).mul(period);
    return float(1).sub(smoothstep(fd.w.negate().add(line), fd.w.add(line), e));
  };
  const lot = () => {
    paint.assign(lineAt(2.5));
  };
  if (fd.hasEdge) {
    const parallel = fd.park.equal(parkingId("street-parallel"));
    const street = fd.onRoad
      .greaterThan(0.5)
      .and(parallel.or(fd.park.equal(parkingId("street-perpendicular"))));
    If(street, () => {
      const depth = select(parallel, float(2), float(5));
      const bay = select(parallel, float(5.5), float(2.5));
      const lane = band(fd.dr, 0, depth, fd.w);
      const edge = band(fd.dr, depth.sub(line), depth.add(line), fd.w);
      const e = abs(fract(q.x.div(bay).add(0.5)).sub(0.5)).mul(bay);
      const sep = float(1).sub(
        smoothstep(fd.w.negate().add(line), fd.w.add(line), e)
      );
      paint.assign(max(edge, sep.mul(lane)));
      baseCol.mulAssign(float(1).sub(lane.mul(0.03).mul(fd.mid).mul(on)));
    }).ElseIf(fd.park.equal(parkingId("lot")), lot);
  } else {
    If(fd.park.equal(parkingId("lot")), lot);
  }
  const fade = float(1).sub(smoothstep(0.06, 0.25, fw));
  baseCol.assign(
    mix(
      baseCol,
      max(baseCol, vec3(0.86, 0.85, 0.82)),
      paint.mul(fade).mul(on).mul(0.8)
    )
  );
}

/**
 * GROUND_DETAIL: kerbs, lawn edges, paving and parking. Updates `baseCol`
 * and returns the accumulated view-space normal tilt (gdTilt).
 */
export function groundDetail(
  g: GroundInputs,
  fd: Fields,
  ugW: F,
  baseCol: V3,
  fw: F
): V3 {
  const on = live(g.groundDetail);
  kerb(g, fd, on, baseCol);

  const lip = band(fd.dl, 0, 0.25, fd.w).mul(fd.near).mul(on);
  baseCol.mulAssign(float(1).sub(lip.mul(0.12)));
  const tilt = toView(fd.outOfLawn)
    .mul(band(fd.dl, -0.02, 0.1, max(fd.w, 0.025)))
    .mul(fd.near.mul(on).mul(0.5))
    .toVar();

  const q = streetFrame(fd, g.xy);
  const pave = on.mul(float(1).sub(ugW)).toVar();
  // Sealed ground off the carriageway takes on the road's grey.
  const concrete = fd.kind.equal(kindId("concrete"));
  const sealed = fd.onRoad
    .lessThan(0.5)
    .and(fd.walkKind.greaterThan(0))
    .and(fd.kind.equal(kindId("asphalt")).or(concrete));
  If(sealed, () => {
    const road = vec3(...ROAD_LINEAR).mul(
      select(concrete, float(1.08), float(1))
    );
    baseCol.assign(mix(baseCol, road, pave.mul(0.6)));
  });
  patterns(fd, g.xy, q, pave, baseCol);
  parking(fd, q, on, baseCol, fw);
  return tilt;
}
