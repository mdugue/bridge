import type { Node, UniformNode, Vector3 } from "three/webgpu";
import {
  abs,
  and,
  bool,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  Fn,
  If,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  normalize,
  or,
  select,
  sin,
  smoothstep,
  step,
  texture,
  textureLoad,
  textureSize,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  ARABLE_CLASS,
  BUILTUP_CLASS,
  LANDCOVER_CLASSES,
  linearPalette,
  RAILWAY_CLASS,
  MEADOW_CLASS,
  PATH_CLASS,
  ROAD_CLASS,
  parkingId,
  EDGE_SCALE,
  PARKING_DEPTH,
  parkingPlaceId,
  SURFACE_ALONG_BITS,
  SURFACE_ALONG_PERIOD,
  type SurfaceKind,
  surfaceId,
} from "@/lib/city/landcover";
import { KERB_HEIGHT } from "@/lib/city/kerbs";
import { LANE_BITS } from "@/lib/city/markings";
import type { F, I, Tex, V2, V3, V4 } from "./shader-chunks";

/**
 * Ground detail in the terrain's colour node, next to the meadow mottle
 * (terrain-layer.ts). Five things:
 *
 * - **Kerb band.** The carriageway (class 7) is the DLM road axis buffered
 *   by its surveyed width, so its edge IS the kerb line. The distance to it
 *   comes from the baked edge raster (pipeline/bake/edges.py: smoothed,
 *   signed, valid out to ±6 m); without it, from the class texels around
 *   the fragment, box-smoothed (valid within a texel of the edge). A pale
 *   stone band on the pavement side and a darker gutter on the road side —
 *   where the other side is ground a kerb borders. On the fine level a real
 *   kerb stone stands on the band (lib/city/kerbs.ts, kerb-layer.ts), and
 *   the band is drawn only where one does: the road-markings raster marks
 *   the texels round every baked kerb line (`LANE_BITS.kerb`), so out of
 *   town, beside water or rails and over a tunnel there is neither stone
 *   nor band (`kerbLines`). The band carries the line into the coarse
 *   level.
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
 *   street: on the carriageway, over the kerb by a metre or on the
 *   pavement) and car parks (bay lines across their aisle, the aisles left
 *   clear). Painted lines only where OSM says the bays are painted, else a
 *   faint tint; faded out by distance.
 * - **Urban green.** Green courtyards, front gardens and parks inside the
 *   DLM's built-up class are painted exactly as meadow.
 *
 * All strengths scale with `GROUND_DETAIL` and `URBAN_GREEN` (below).
 * The class and paving rasters are read with `textureLoad`, the edge
 * raster at an explicit level 0, so no implicit derivative is taken in
 * non-uniform control flow.
 *
 * The state the chunks share is explicit: the terrain hands every one the
 * same `GroundInputs` (read-only) and `GroundColour` (the running colour
 * and the meadow weights, vars they assign), and the fields `groundFields`
 * returns. Every value that crosses a branch is a `toVar()` declared where
 * the GLSL declared its local: a shared expression first built inside one
 * branch would otherwise be assigned there only.
 */

type I2 = Node<"ivec2">;
type B = Node<"bool">;

/**
 * Bodendetail: how strongly the kerbs, lawn edges, parking, road markings,
 * allotment beds, sports grounds' texture and the paving show from close
 * by — fixed at what its slider stood at (plan 073). The markings and the
 * beds reach full strength at it (`÷ 0.7`).
 */
export const GROUND_DETAIL: F = float(0.7);
/**
 * Stadtgrün: green courtyards, front gardens and parks inside the
 * settlement painted as meadow, at full strength — fixed since its slider
 * went (plan 073).
 */
const URBAN_GREEN: F = float(1);

/** What every ground chunk reads (the terrain's colour node makes it). */
export interface GroundInputs {
  /** the splat uv (v grows southward), a var */
  uv: V2;
  /** the fragment's data-frame XY (m), a var */
  xy: V2;
  /** the tile's size (m) */
  size: [number, number];
  /** the NEAREST class-id raster */
  classTexture: Tex;
  /** metres per pixel (the larger fwidth of `xy`), a var */
  fw: F;
  /** the class id at the fragment (float), a var */
  cls: F;
  /** world, surface → sun */
  sunDirection: UniformNode<"vec3", Vector3>;
  /** the meadow's and the road's palette colours, linear */
  meadowColor: V3;
  roadColor: V3;
}

/** The running colour and the meadow weights (vars the chunks assign). */
export interface GroundColour {
  baseCol: V3;
  /** 1 on meadow (and, from `urbanGreen`, urban green) */
  meadow: F;
  /** the meadow's normal break-up weight */
  detail: F;
  /** the meadow's value mottle (−1..1) */
  mottle: F;
  /**
   * How much of the ground is paint — parking bays, road markings, sports
   * lines — for the Papier style's pencil grey (terrain-layer.ts).
   */
  paperInk: F;
  /** how much of the ground is a path (`smoothPaths`: a smooth edge near
   *  the camera, the class farther out) — what the sanded grain follows */
  path: F;
  /** the class beside the path (`smoothPaths`; the fragment's own class
   *  where no path is near) — what a path's stray texels are paved as */
  pathSide: I;
  /** 1 where `smoothPaths` drew a path's edge (a path near, the camera
   *  near), else 0 */
  pathNear: F;
  /** the way to the path (`smoothPaths`: its coverage's gradient, unit,
   *  x east, y north; 0 where no path is near) */
  pathToward: V2;
}

/** The fields every later chunk reads (vars, or JS where the GLSL knew). */
export interface GroundFields {
  /** signed distance (m) to the road edge, + on the road */
  dr: F;
  /** signed distance (m) to the lawn edge, + on the lawn */
  dl: F;
  intoRoad: V2;
  outOfLawn: V2;
  /** the distances hold metres out (the baked edge raster), not just at
   *  the edge — known when the material is made */
  hasEdge: boolean;
  kerbOk: F;
  roadKind: I;
  walkKind: I;
  park: I;
  /** where a street's bays lie across the kerb (`PARKING_PLACES`) and
   *  whether they are painted (the paving raster's A byte) */
  parkPlace: I;
  parkPainted: B;
  /** the street bearing (rad from east) and whether the paving raster
   *  gives the street's frame here, with the distance along it */
  head: F;
  hasFrame: B;
  alongM: F;
  onRoad: B;
  /** the paving kind (surfaceId) */
  kind: I;
  /** the share of the paving raster's texels round the fragment that name
   *  sealed ground (asphalt, concrete), a sanded path, and any walk
   *  surface at all — B-spline-smoothed near the camera (`walkShares`), so a tint
   *  the walk kind decides fades over a texel instead of stepping */
  sealedW: F;
  sandW: F;
  walkW: F;
  /** AA half-width (m per pixel) and the three distance fades */
  w: F;
  near: F;
  mid: F;
  fine: F;
  /** the accumulated shading-normal tilt (view space) */
  tilt: V3;
  /** the position from the tile's north-west corner (m, x east, y north) */
  local: V2;
}

const id = (kind: SurfaceKind) => surfaceId(kind);

// Every pattern length along a street below divides SURFACE_ALONG_PERIOD —
// bays 2.5 and 5.5 m, slabs 0.5, sett 0.15, concrete plates 5.5, grass
// pavers 0.55 — so the wrap of the baked coordinate never shows.
const ALONG_PERIOD = SURFACE_ALONG_PERIOD;

// --- shared helpers (the sport, marking and colony chunks use them too) -------

/** GLSL's `mod`: floored, so negative values wrap like the bake's. */
export const floorMod = (x: F, y: F | number): F =>
  x.sub(floor(x.div(y)).mul(y));

/** A raster's size in texels (level 0). */
export const texelSize = (t: Tex, uv: V2): I2 =>
  // reason: TextureSizeNode is typed as a bare Node; it is a uvec2.
  ivec2(textureSize(texture(t, uv), int(0)) as unknown as Node<"uvec2">);

// reason: TSL's clamp runs on integer vectors (WGSL clamp on vec2<i32>),
// but its typings only cover float ones.
const clampI2 = clamp as unknown as (x: I2, lo: I2, hi: I2) => I2;

/** The texel at `p`, clamped into the raster (`size` from `texelSize`). */
export const texelAt = (t: Tex, p: I2, size: I2): V4 =>
  textureLoad(t, clampI2(p, ivec2(0, 0), size.sub(ivec2(1, 1))));

/** The texel at `p` of a table texture (the row lookups: always inside). */
export const loadTexel = (t: Tex, p: I2): V4 => textureLoad(t, p);

/** A byte of a UNORM8 channel as a float 0..255 (rounded). */
export const byteOf = (v: F): F => floor(v.mul(255).add(0.5));

// The helpers every chunk calls many times are shader functions (a layout
// each), not inlined node trees: inlined, the ~100 hash calls of the ground,
// garden and pitch terms blew the fragment shader up several times over.

/** Hash without sin (stable at large coordinates), Dave Hoskins' hash12. */
export const gdHash = Fn(
  ([p]: [V2]): F => {
    const a = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    a.addAssign(dot(a, a.yzx.add(33.33)));
    return fract(a.x.add(a.y).mul(a.z));
  },
  { p: "vec2", return: "float" }
);

/** Value noise on the hash. */
export const gdNoise = Fn(
  ([p]: [V2]): F => {
    const i = floor(p).toVar();
    const f0 = fract(p).toVar();
    const f = f0
      .mul(f0)
      .mul(vec2(3).sub(f0.mul(2)))
      .toVar();
    return mix(
      mix(gdHash(i), gdHash(i.add(vec2(1, 0))), f.x),
      mix(gdHash(i.add(vec2(0, 1))), gdHash(i.add(vec2(1, 1))), f.x),
      f.y
    );
  },
  { p: "vec2", return: "float" }
);

/** `gdNoise`'s gradient at `p` (per unit of `p`), analytic: its four
 *  corner hashes once, not a noise read per difference. */
export const gdNoiseSlope = Fn(
  ([p]: [V2]): V2 => {
    const i = floor(p).toVar();
    const f0 = fract(p).toVar();
    const u = f0
      .mul(f0)
      .mul(vec2(3).sub(f0.mul(2)))
      .toVar();
    const du = f0.mul(float(1).sub(f0)).mul(6);
    const a = gdHash(i).toVar();
    const b = gdHash(i.add(vec2(1, 0)))
      .sub(a)
      .toVar();
    const c = gdHash(i.add(vec2(0, 1)))
      .sub(a)
      .toVar();
    const d = gdHash(i.add(vec2(1, 1)))
      .sub(a)
      .sub(b)
      .sub(c);
    return du.mul(vec2(b.add(d.mul(u.y)), c.add(d.mul(u.x))));
  },
  { p: "vec2", return: "vec2" }
);

/** 1 inside [a, b] (m), anti-aliased over w on either edge. */
export const gdBand = Fn(
  ([d, a, b, w]: [F, F, F, F]): F =>
    smoothstep(a.sub(w), a.add(w), d).sub(smoothstep(b.sub(w), b.add(w), d)),
  { d: "float", a: "float", b: "float", w: "float", return: "float" }
);

// --- ground-detail private helpers ---------------------------------------------

/** The class id at a texel of the class raster. */
const classAt = (inp: GroundInputs, p: I2, size: I2): I =>
  int(byteOf(texelAt(inp.classTexture, p, size).r));

/** ground a kerb borders: background, meadow, forest, copse, built-up,
 *  path, and the arable land (meadow until it was a class of its own) */
const kerbable = (c: I): F =>
  select(
    or(
      c.lessThanEqual(BUILTUP_CLASS),
      or(c.equal(PATH_CLASS), c.equal(ARABLE_CLASS))
    ),
    1,
    0
  );

const isClass = (c: I, k: number): F => select(c.equal(k), 1, 0);

/** The ground with a lawn's edge: meadow, and the arable land as edges.py
 *  counts it. */
const isLawn = (c: I): F =>
  select(or(c.equal(MEADOW_CLASS), c.equal(ARABLE_CLASS)), 1, 0);

/** A data-frame horizontal direction in view space (world = data (x, z, −y)). */
const toView = (d: V2): V3 =>
  cameraViewMatrix.mul(vec4(d.x, 0, d.y.negate(), 0)).xyz;

/**
 * Bilinear 0/1 field (x) and its gradient per metre in the data frame (yz).
 * Texel rows grow southward, so the data-y gradient is the negated row one.
 */
function gdField(c: V4, f: V2, mpt: V2): V3 {
  const v = mix(mix(c.x, c.y, f.x), mix(c.z, c.w, f.x), f.y);
  const gu = mix(c.y.sub(c.x), c.w.sub(c.z), f.y).div(mpt.x);
  const gv = mix(c.z.sub(c.x), c.w.sub(c.y), f.x).div(mpt.y);
  return vec3(v, gu, gv.negate());
}

/**
 * The same field over a 4×4 texel block, each corner the 3×3 mean around
 * it before the bilinear step: a box-smoothed class edge, whose isoline
 * runs straight along a diagonal instead of following the raster's
 * staircase. 16 fetches (unrolled here), so only near the camera.
 */
function gdSmooth(
  inp: GroundInputs,
  i: I2,
  f: V2,
  mpt: V2,
  size: I2
): { lawn: V3; road: V3 } {
  const road: F[] = [];
  const lawn: F[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const c = classAt(inp, i.add(ivec2(x - 1, y - 1)), size).toVar();
      road.push(isClass(c, ROAD_CLASS));
      lawn.push(isLawn(c));
    }
  }
  const corner = (m: F[], k: number): F => {
    const cx = 1 + (k & 1);
    const cy = 1 + (k >> 1);
    let sum: F = float(0);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        sum = sum.add(m[(cy + dy) * 4 + cx + dx]);
      }
    }
    return sum.div(9);
  };
  const corners = (m: F[]): V4 =>
    vec4(corner(m, 0), corner(m, 1), corner(m, 2), corner(m, 3));
  return {
    road: gdField(corners(road), f, mpt),
    lawn: gdField(corners(lawn), f, mpt),
  };
}

/** Signed distance (m) to the field's 0.5 isoline, positive inside. */
function gdSd(fld: V3): F {
  const g = length(fld.yz);
  return select(
    g.greaterThan(1e-4),
    fld.x.sub(0.5).div(g),
    select(fld.x.greaterThan(0.5), 1e3, -1e3)
  );
}

/** 1 on a joint of a (size.x × size.y) grid, joint width jw (m). */
function gdJoint(q: V2, size: V2, jw: number, w: F): F {
  // cells are centred on whole multiples of size, so joints sit halfway
  const e = abs(fract(q.div(size)).sub(0.5)).mul(size);
  const m = min(e.x, e.y);
  return float(1).sub(smoothstep(float(jw * 0.5).sub(w), w.add(jw * 0.5), m));
}

// --- the fields ----------------------------------------------------------------

/** The baked, smoothed distance fields (edges.py): signed metres. */
const edgeAt = (edges: Tex, uv: V2): V2 =>
  texture(edges, uv).level(float(0)).rg.mul(255).sub(128).div(EDGE_SCALE);

/** The baked distances: valid out to ±6 m, straight along a diagonal kerb,
 *  with their gradient (central differences, uv grows south). */
function bakedDistances(inp: GroundInputs, edges: Tex, g: GroundFields) {
  const et = vec2(1)
    .div(vec2(texelSize(edges, inp.uv)))
    .toVar();
  const e = edgeAt(edges, inp.uv).toVar();
  const ex = edgeAt(edges, inp.uv.add(vec2(et.x, 0)))
    .sub(edgeAt(edges, inp.uv.sub(vec2(et.x, 0))))
    .toVar();
  const ey = edgeAt(edges, inp.uv.sub(vec2(0, et.y)))
    .sub(edgeAt(edges, inp.uv.add(vec2(0, et.y))))
    .toVar();
  g.dr.assign(e.x);
  g.dl.assign(e.y);
  g.intoRoad.assign(normalize(vec2(ex.x, ey.x).add(1e-6)));
  g.outOfLawn.assign(normalize(vec2(ex.y, ey.y).add(1e-6)).negate());
}

/** No baked distances (the coarse level, a site without the bake): the
 *  class texels, box-smoothed near the camera. Valid within about a texel
 *  of the edge only — enough for the kerb band, not for parking lanes. */
function classDistances(
  inp: GroundInputs,
  g: GroundFields,
  grid: { f: V2; i: I2; lawn: V3; mpt: V2; road: V3; size: I2 }
) {
  If(and(inp.fw.lessThan(0.5), GROUND_DETAIL.greaterThan(0)), () => {
    const s = gdSmooth(inp, grid.i, grid.f, grid.mpt, grid.size);
    const re = s.road.toVar();
    const le = s.lawn.toVar();
    g.dr.assign(gdSd(re));
    g.dl.assign(gdSd(le));
    g.intoRoad.assign(normalize(re.yz.add(1e-6)));
    g.outOfLawn.assign(normalize(le.yz.add(1e-6)).negate());
  }).Else(() => {
    g.dr.assign(gdSd(grid.road));
    g.dl.assign(gdSd(grid.lawn));
  });
}

/** The paving raster (surface.py): the kinds, the parking and the street's
 *  frame — along = offset + (position from the tile's north-west corner) · d,
 *  exactly as the bake defines it. */
function pavingFields(inp: GroundInputs, surface: Tex, g: GroundFields) {
  const ss = texelSize(surface, inp.uv).toVar();
  const s = texelAt(surface, ivec2(inp.uv.mul(vec2(ss))), ss).toVar();
  const byte = int(byteOf(s.r)).toVar();
  g.roadKind.assign(byte.bitAnd(7));
  g.walkKind.assign(byte.shiftRight(3).bitAnd(7));
  g.park.assign(byte.shiftRight(6));
  // A: the offset's high bits, then the parking place and its paint
  const high = int(byteOf(s.a)).toVar();
  g.parkPlace.assign(high.shiftRight(5).bitAnd(3));
  g.parkPainted.assign(high.shiftRight(7).equal(1));
  const gb = byteOf(s.g).toVar();
  If(gb.greaterThan(0.5), () => {
    g.hasFrame.assign(true);
    g.head.assign(
      gb
        .sub(1)
        .div(254)
        .mul(2 * Math.PI)
    );
    const offset = byteOf(s.b)
      .add(float(high.bitAnd(31)).mul(256))
      .div(2 ** SURFACE_ALONG_BITS)
      .mul(ALONG_PERIOD);
    g.alongM.assign(
      floorMod(
        offset.add(dot(g.local, vec2(cos(g.head), sin(g.head)))),
        ALONG_PERIOD
      )
    );
  });
}

/** The walk kind of a paving-raster texel (`pavingFields`' bits 3–5). */
const walkOf = (s: V4): I => int(byteOf(s.r)).shiftRight(3).bitAnd(7);

/**
 * The walk kinds' shares round the fragment (`GroundFields.sealedW`,
 * `sandW`, `walkW`): the 4×4 paving texels round it under a cubic
 * B-spline, cut at one half, near the camera; the fragment's own texel
 * beyond. The raster is a metre a texel
 * and a path is often two of them at a slant, its texels' kinds mixed
 * where two ways or a way and a path default meet — read NEAREST, the
 * grey of sealed ground and the sand of a path came out as blocks, and
 * read bilinear as teeth along a slanted edge.
 */
function walkShares(inp: GroundInputs, surface: Tex, g: GroundFields): void {
  const sealed = (k: I): F =>
    select(or(k.equal(id("asphalt")), k.equal(id("concrete"))), 1, 0);
  const sand = (k: I): F => select(k.equal(id("unpaved")), 1, 0);
  const any = (k: I): F => select(k.greaterThan(0), 1, 0);
  g.sealedW.assign(sealed(g.walkKind));
  g.sandW.assign(sand(g.walkKind));
  g.walkW.assign(any(g.walkKind));
  If(inp.fw.lessThan(WALK_SHARE_FW), () => {
    const size = texelSize(surface, inp.uv).toVar();
    const p = inp.uv.mul(vec2(size)).sub(0.5).toVar();
    const i = ivec2(floor(p)).toVar();
    const f = p.sub(floor(p)).toVar();
    // the 4×4 texels round the fragment under a cubic B-spline: a smooth
    // field (bilinear, a slanted edge's stairs came out as teeth) ...
    const wx = bspline(f.x).toVar();
    const wy = bspline(f.y).toVar();
    const ax = [wx.x, wx.y, wx.z, wx.w];
    const ay = [wy.x, wy.y, wy.z, wy.w];
    const s = float(0).toVar();
    const u = float(0).toVar();
    const a = float(0).toVar();
    for (let y = -1; y <= 2; y++) {
      for (let x = -1; x <= 2; x++) {
        const k = walkOf(texelAt(surface, i.add(ivec2(x, y)), size)).toVar();
        const wgt = ax[x + 1].mul(ay[y + 1]);
        s.addAssign(sealed(k).mul(wgt));
        u.addAssign(sand(k).mul(wgt));
        a.addAssign(any(k).mul(wgt));
      }
    }
    // ... cut on its half-way line, soft over a pixel or a few centimetres
    const slope = vec2(size).x.div(inp.size[0]).mul(BSPLINE_STEP_SLOPE);
    const soft = max(inp.fw.mul(0.75), float(WALK_EDGE_M)).mul(slope).toVar();
    // faded into the own texel's answer over the last third, no ring
    const near = float(1)
      .sub(smoothstep(WALK_SHARE_FW * 0.65, WALK_SHARE_FW, inp.fw))
      .toVar();
    const cut = (v: F, own: F): F =>
      mix(own, smoothstep(float(0.5).sub(soft), soft.add(0.5), v), near);
    g.sealedW.assign(cut(s, g.sealedW));
    g.sandW.assign(cut(u, g.sandW));
    g.walkW.assign(cut(a, g.walkW));
  });
}

/** How soft a walk surface's edge is (m), where the pixel is finer. */
const WALK_EDGE_M = 0.12;

/** The walk kinds' shares are read smoothed out to this many metres a
 *  pixel: a texel is a metre, so past it the pixel spans them anyway. */
const WALK_SHARE_FW = 1;

/**
 * The kerb band only round a baked kerb line: the share of the four
 * road-markings texels round the fragment that carry the kerb bit
 * (pipeline/bake/markings.py `KERB`, set out to 2 m and a texel's diagonal
 * from every line edges.py keeps), bilinear, so the band fades over a
 * texel where a kerb ends. It replaces the classes' answer: edges.py drew
 * its lines by the same rule (no kerb at water or railway) and also where
 * both sides are road land — a carriageway beside a green verge, which
 * edges.py counts as meadow. Read only near the camera, where the band
 * shows.
 */
function kerbLines(inp: GroundInputs, g: GroundFields, raster: Tex): void {
  If(inp.fw.lessThan(0.5), () => {
    const size = texelSize(raster, inp.uv).toVar();
    const p = inp.uv.mul(vec2(size)).sub(0.5).toVar();
    const i = ivec2(floor(p)).toVar();
    const f = p.sub(floor(p)).toVar();
    const bit = (dx: number, dy: number): F =>
      select(
        int(byteOf(texelAt(raster, i.add(ivec2(dx, dy)), size).y))
          .bitAnd(LANE_BITS.kerb)
          .notEqual(0),
        1,
        0
      );
    g.kerbOk.assign(
      mix(mix(bit(0, 0), bit(1, 0), f.x), mix(bit(0, 1), bit(1, 1), f.x), f.y)
    );
  });
}

/** The class's palette colour (linear), as the splat paints it (the
 *  splat's own conversion, landcover-splat.ts). */
const PALETTE_LINEAR = LANDCOVER_CLASSES.map((_, k) =>
  linearPalette().slice(k * 3, k * 3 + 3)
);
export const paletteOf = (c: I): V3 => {
  let out: V3 = vec3(...(PALETTE_LINEAR[0] as [number, number, number]));
  for (let k = 1; k < PALETTE_LINEAR.length; k++) {
    out = select(
      c.equal(k),
      vec3(...(PALETTE_LINEAR[k] as [number, number, number])),
      out
    );
  }
  return out;
};

/** The cubic B-spline weights' slopes at `t` (d/dt, taps −1, 0, 1, 2). */
const bsplineSlope = (t: F): V4 => {
  const t2 = t.mul(t);
  const u = float(1).sub(t);
  return vec4(
    u.mul(u).negate(),
    t2.mul(3).sub(t.mul(4)),
    t2.mul(-3).add(t.mul(2)).add(1),
    t2
  ).div(2);
};

/** The cubic B-spline's four weights at `t` (taps −1, 0, 1, 2). */
const bspline = (t: F): V4 => {
  const t2 = t.mul(t);
  const t3 = t2.mul(t);
  const u = float(1).sub(t);
  return vec4(
    u.mul(u).mul(u),
    t3.mul(3).sub(t2.mul(6)).add(4),
    t3.mul(-3).add(t2.mul(3)).add(t.mul(3)).add(1),
    t3
  ).div(6);
};

/**
 * A texture read through a cubic B-spline at mip `level` (four bilinear
 * taps: Sigg and Hadwiger, GPU Gems 2 ch. 20): a smooth field where the
 * bilinear read has a crease at every texel, which a raster coarser than
 * the pixels it covers shows as squares. `size` is the texture's level-0
 * size.
 */
export function bsplineSample(t: Tex, uv: V2, size: I2, level: number): V4 {
  // a mip's size is floored (a 250 px raster's mip 2 is 62 px, not 62.5)
  const texels = max(floor(vec2(size).div(2 ** level)), vec2(1)).toVar();
  const p = uv.mul(texels).sub(0.5).toVar();
  const i = floor(p).toVar();
  const f = p.sub(i).toVar();
  const wx = bspline(f.x).toVar();
  const wy = bspline(f.y).toVar();
  const g0 = vec2(wx.x.add(wx.y), wy.x.add(wy.y)).toVar();
  const g1 = vec2(wx.z.add(wx.w), wy.z.add(wy.w)).toVar();
  const h0 = i
    .sub(0.5)
    .add(vec2(wx.y.div(g0.x), wy.y.div(g0.y)))
    .div(texels)
    .toVar();
  const h1 = i
    .add(1.5)
    .add(vec2(wx.w.div(g1.x), wy.w.div(g1.y)))
    .div(texels)
    .toVar();
  const at = (x: V2): V4 => texture(t, x).level(float(level));
  return at(vec2(h0.x, h0.y))
    .mul(g0.x.mul(g0.y))
    .add(at(vec2(h1.x, h0.y)).mul(g1.x.mul(g0.y)))
    .add(at(vec2(h0.x, h1.y)).mul(g0.x.mul(g1.y)))
    .add(at(vec2(h1.x, h1.y)).mul(g1.x.mul(g1.y)));
}

/** Paths are drawn smooth out to this many metres a pixel (faded over
 *  the last third). */
const PATH_NEAR_FW = 1.2;
/** The path's iso line on its smoothed coverage (a hair under the half a
 *  straight edge gives, so a narrow path keeps its width), how far the
 *  worn edge wanders and how soft it frays (m). */
const PATH_ISO = 0.45;
const PATH_WANDER_M = 0.12;
const PATH_FADE_M = 0.25;
/** How far the lawn beside a path reaches past the baked lawn line, up
 *  to the path's smooth edge (m). */
const PATH_LAWN_REACH_M = 1.2;
/** A B-spline-smoothed step's slope at the step: two thirds a texel. */
const BSPLINE_STEP_SLOPE = 2 / 3;

/**
 * Paths with a smooth, worn edge near the camera. The splat paints a
 * 1 m (a phone's 2 m) colour texel, the mean of the class texels under
 * it, and the ground reads it bilinear: a narrow path running at a slant
 * (a forest path; a park path two texels wide) came out as a mosaic of
 * diamonds and teeth. Here, where the class texels round the fragment
 * hold a path, their path coverage is weighted by a cubic B-spline, the
 * edge cut on that smooth field's iso line — wandering a little by a
 * world-space noise and fraying over a few decimetres, as a trodden path
 * does into the ground beside it — and the palette colours of the path
 * and of the ground beside it (the nearest class texel that is not path)
 * painted across it. Farther out, where a texel is under a pixel's
 * footprint, the splat takes over again. Returns the colour, the path's
 * weight (the sand, the slabs and the urban green follow it) and the
 * class beside it. The colour splat's alpha (water) is not touched.
 */
export function smoothPaths(
  inp: GroundInputs,
  splat: V3
): { col: V3; path: F; side: I; near: F; toward: V2 } {
  const col = splat.toVar();
  const toward = vec2(0).toVar();
  const path = select(inp.cls.equal(PATH_CLASS), float(1), float(0)).toVar();
  const side = int(inp.cls).toVar();
  const by = float(0).toVar();
  const near = float(1)
    .sub(smoothstep(PATH_NEAR_FW * 0.65, PATH_NEAR_FW, inp.fw))
    .toVar();
  If(near.greaterThan(0), () => {
    const size = texelSize(inp.classTexture, inp.uv).toVar();
    const p = inp.uv.mul(vec2(size)).sub(0.5).toVar();
    const i = ivec2(floor(p)).toVar();
    const f = p.sub(floor(p)).toVar();
    // a path within a metre or so, and the ground beside it: the nearest
    // of the four central texels that is not path, else any in the 4×4;
    // and the path's coverage: its class texels in the 4×4 round the
    // fragment, weighted by a cubic B-spline — a C2-smooth field at the
    // class raster's own resolution, whatever the colour splat's
    const wx = bspline(f.x).toVar();
    const wy = bspline(f.y).toVar();
    const ax = [wx.x, wx.y, wx.z, wx.w];
    const ay = [wy.x, wy.y, wy.z, wy.w];
    const dx = bsplineSlope(f.x).toVar();
    const dy = bsplineSlope(f.y).toVar();
    const bx = [dx.x, dx.y, dx.z, dx.w];
    const by_ = [dy.x, dy.y, dy.z, dy.w];
    const any = float(0).toVar();
    const cover = float(0).toVar();
    const grad = vec2(0).toVar();
    const outer = int(PATH_CLASS).toVar();
    const central: I[] = [];
    for (let y = -1; y <= 2; y++) {
      for (let x = -1; x <= 2; x++) {
        const c = classAt(inp, i.add(ivec2(x, y)), size).toVar();
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
          central.push(c);
        }
        const on = isClass(c, PATH_CLASS);
        any.assign(max(any, on));
        cover.addAssign(on.mul(ax[x + 1].mul(ay[y + 1])));
        grad.addAssign(
          on.mul(vec2(bx[x + 1].mul(ay[y + 1]), ax[x + 1].mul(by_[y + 1])))
        );
        outer.assign(select(c.notEqual(PATH_CLASS), c, outer));
      }
    }
    // the four central texels, the fragment's nearest first
    const [k00, k10, k01, k11] = central as [I, I, I, I];
    const left = f.x.lessThan(0.5);
    const low = f.y.lessThan(0.5);
    const at = (ax: B, ay: B): I =>
      select(ax, select(ay, k00, k01), select(ay, k10, k11));
    const c0 = at(left, low).toVar();
    const c1 = at(left.not(), low).toVar();
    const c2 = at(left, low.not()).toVar();
    const c3 = at(left.not(), low.not()).toVar();
    const other = select(
      c0.notEqual(PATH_CLASS),
      c0,
      select(
        c1.notEqual(PATH_CLASS),
        c1,
        select(
          c2.notEqual(PATH_CLASS),
          c2,
          select(c3.notEqual(PATH_CLASS), c3, outer)
        )
      )
    ).toVar();
    // a path's own middle (no other class round it) needs nothing
    If(and(any.greaterThan(0.5), other.notEqual(PATH_CLASS)), () => {
      const pathCol = paletteOf(int(PATH_CLASS)).toVar();
      const otherCol = paletteOf(other).toVar();
      // coverage per metre across an edge: the class texel's size (half a
      // metre, a phone's metre) turns the metres below into coverage
      const slope = vec2(size).x.div(inp.size[0]).mul(BSPLINE_STEP_SLOPE);
      const wander = gdNoise(inp.xy.mul(0.45))
        .sub(0.5)
        .mul(0.75)
        .add(gdNoise(inp.xy.mul(2.1).add(31)).sub(0.5).mul(0.25))
        .mul(slope.mul(PATH_WANDER_M * 2));
      // the coverage a pixel spans, and the worn edge's own width
      const fade = max(inp.fw.mul(0.75), float(PATH_FADE_M)).mul(slope);
      const m = smoothstep(
        float(PATH_ISO).sub(fade),
        float(PATH_ISO).add(fade),
        cover.add(wander)
      ).toVar();
      // the palette's colours near the path only: farther out the splat's
      // own blend of the classes beside it comes back, smoothly, so the
      // window's end draws no seam
      const own = smoothstep(0, 0.2, cover);
      col.assign(mix(col, mix(otherCol, pathCol, m), near.mul(own)));
      path.assign(mix(path, m, near));
      side.assign(other);
      // how near the path is, as smooth as its coverage: a hard 1 inside
      // the 4×4 notched the lawn line where the window ends
      by.assign(near.mul(smoothstep(0, 0.04, cover)));
      // (the raster's rows run south)
      toward.assign(normalize(vec2(grad.x, grad.y.negate()).add(1e-6)));
    });
  });
  return { col, path, side, near: by, toward };
}

/** 1 on the ground a walk kind paints (`pavingKind`: built-up, path,
 *  unclassified land), and along a path's smooth edge (`smoothPaths`) —
 *  a walk's buffer burned over a meadow or a wood leaves it as it is. */
const walkGround = (inp: GroundInputs, col: GroundColour): F => {
  const cls = int(inp.cls);
  return max(
    select(
      or(cls.equal(BUILTUP_CLASS), cls.equal(PATH_CLASS), cls.equal(0)),
      float(1),
      float(0)
    ),
    col.path
  );
};

/** A weight that only a class default answers to: 0 where the paving
 *  raster names the surface. */
const byClass = (g: GroundFields, w: F): F =>
  select(g.walkKind.greaterThan(0), float(0), w);

/** The paving kind: the raster's, else the class's default. */
function pavingKind(g: GroundFields, cls: I): void {
  If(g.onRoad, () => {
    g.kind.assign(
      select(g.roadKind.greaterThan(0), g.roadKind, int(id("asphalt")))
    );
  })
    .ElseIf(cls.equal(BUILTUP_CLASS), () => {
      g.kind.assign(
        select(g.walkKind.greaterThan(0), g.walkKind, int(id("paving")))
      );
    })
    .ElseIf(cls.equal(PATH_CLASS), () => {
      g.kind.assign(
        select(g.walkKind.greaterThan(0), g.walkKind, int(id("unpaved")))
      );
    })
    .ElseIf(cls.equal(0), () => {
      g.kind.assign(g.walkKind);
    });
}

/**
 * The fields every later chunk reads: the road and lawn distances, the
 * paving kind and the street direction. After the meadow mottle. `kerbs`
 * is the road-markings raster (its kerb bits; with the baked edges only).
 */
export function groundFields(
  inp: GroundInputs,
  surface?: Tex,
  edges?: Tex,
  kerbs?: Tex
): GroundFields {
  const size = texelSize(inp.classTexture, inp.uv).toVar();
  const texels = vec2(size).toVar();
  const mpt = vec2(inp.size[0], inp.size[1]).div(texels).toVar();
  const p = inp.uv.mul(texels).sub(0.5).toVar();
  const i = ivec2(floor(p)).toVar();
  const f = p.sub(floor(p)).toVar();
  const c00 = classAt(inp, i, size).toVar();
  const c10 = classAt(inp, i.add(ivec2(1, 0)), size).toVar();
  const c01 = classAt(inp, i.add(ivec2(0, 1)), size).toVar();
  const c11 = classAt(inp, i.add(ivec2(1, 1)), size).toVar();
  const four = (fn: (c: I) => F): V4 =>
    vec4(fn(c00), fn(c10), fn(c01), fn(c11));
  const road = gdField(
    four((c) => isClass(c, ROAD_CLASS)),
    f,
    mpt
  ).toVar();
  const lawn = gdField(four(isLawn), f, mpt).toVar();
  const g: GroundFields = {
    dr: float(-1e3).toVar(),
    dl: float(-1e3).toVar(),
    intoRoad: vec2(1, 0).toVar(),
    outOfLawn: vec2(1, 0).toVar(),
    hasEdge: edges !== undefined,
    kerbOk: float(0),
    roadKind: int(0).toVar(),
    walkKind: int(0).toVar(),
    park: int(0).toVar(),
    parkPlace: int(0).toVar(),
    parkPainted: bool(false).toVar(),
    head: float(0).toVar(),
    hasFrame: bool(false).toVar(),
    alongM: float(0).toVar(),
    onRoad: bool(false),
    kind: int(0),
    sealedW: float(0).toVar(),
    sandW: float(0).toVar(),
    walkW: float(0).toVar(),
    w: float(0),
    near: float(0),
    mid: float(0),
    fine: float(0),
    tilt: vec3(0).toVar(),
    local: vec2(
      inp.uv.x.mul(inp.size[0]),
      inp.uv.y.negate().mul(inp.size[1])
    ).toVar(),
  };
  if (edges) {
    bakedDistances(inp, edges, g);
  } else {
    classDistances(inp, g, { i, f, mpt, road, lawn, size });
  }
  g.kerbOk = gdField(four(kerbable), f, mpt).x.toVar();
  if (edges && kerbs) {
    kerbLines(inp, g, kerbs);
  }
  if (surface) {
    pavingFields(inp, surface, g);
    walkShares(inp, surface, g);
  }
  const cls = int(inp.cls).toVar();
  g.onRoad = g.dr.greaterThan(0).toVar();
  g.kind = int(0).toVar();
  pavingKind(g, cls);
  g.w = max(inp.fw, 0.002).toVar();
  g.near = float(1)
    .sub(smoothstep(0.12, 0.5, inp.fw))
    .toVar(); // kerbs, lawn edges
  g.mid = float(1)
    .sub(smoothstep(0.05, 0.35, inp.fw))
    .toVar(); // mottles
  g.fine = float(1)
    .sub(smoothstep(0.012, 0.05, inp.fw))
    .toVar(); // stones, joints
  return g;
}

/**
 * Urban green: built-up or unclassified ground that is green — courtyards,
 * front gardens, parks inside the settlement — painted exactly as meadow
 * (its colour, mottle, NDVI tint and lawn edge). With the baked edges the
 * mask is theirs (edges.py counts NDVI-green, unsealed built-up ground as
 * meadow, the green railway land off the tracks and the road land clear
 * of everything paved that is green, low ground or a wood: the
 * embankments, verges, islands and wooded strips the DLM's parcels hold);
 * without, the NDVI decides here, on built-up ground alone. Returns its
 * weight (`ugW`).
 */
export function urbanGreen(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  ndvi?: Tex
): F {
  const cls = int(inp.cls);
  // a path in built-up land counts as the land beside it, its own share
  // taken out along its smooth edge (`smoothPaths`) — not texel by texel
  const builtUp = (c: I) => or(c.equal(BUILTUP_CLASS), c.equal(0));
  const built = select(
    or(builtUp(cls), and(cls.equal(PATH_CLASS), builtUp(col.pathSide))),
    float(1),
    float(0)
  ).mul(float(1).sub(col.path));
  let mask: F = float(0);
  if (g.hasEdge) {
    // edges.py's meadow also holds the green railway land off the tracks
    // and the green road land past the carriageways (its verges).
    const ground = select(
      or(cls.equal(RAILWAY_CLASS), cls.equal(ROAD_CLASS)),
      1,
      built
    );
    // beside a path the lawn reaches on to the path's own smooth edge:
    // the baked lawn line keeps a texel off the path's stairs, which left
    // a bare band between the two — on the lawn's side only (out of the
    // lawn is toward the path), never across the path onto the paving
    // beyond it
    const lawnSide = smoothstep(-0.2, 0.2, dot(g.outOfLawn, col.pathToward));
    mask = smoothstep(
      -0.15,
      0.15,
      g.dl.add(col.pathNear.mul(lawnSide).mul(PATH_LAWN_REACH_M))
    ).mul(ground);
  } else if (ndvi) {
    const paved = and(
      g.walkKind.greaterThan(0),
      g.walkKind.lessThanEqual(id("sett"))
    );
    mask = smoothstep(0.22, 0.34, texture(ndvi, inp.uv).bias(float(1)).r)
      .mul(built)
      .mul(select(paved, 0, 1))
      .mul(select(g.onRoad, 0, 1));
  }
  const strength = ndvi || g.hasEdge ? URBAN_GREEN : float(0);
  const ugW = mask.mul(strength).toVar();
  // Meadow from here on: the colour, the mottle, and (the NDVI tint,
  // after) the lush-to-dry tint and the normal break-up.
  col.baseCol.assign(
    mix(col.baseCol, inp.meadowColor.mul(col.mottle.mul(0.035).add(1)), ugW)
  );
  col.meadow.assign(max(col.meadow, ugW));
  col.detail.assign(
    max(col.detail, ugW.mul(float(1).sub(smoothstep(0.5, 2.5, inp.fw))))
  );
  return ugW;
}

// --- the detail ----------------------------------------------------------------

/** Kerb: stone on the pavement side, gutter on the road side, and the
 *  kerb's own shadow on the road. */
function kerb(inp: GroundInputs, col: GroundColour, g: GroundFields): void {
  // On the fine level a real kerb stone stands on the band (kerbs.ts);
  // the band carries it into the coarse level and the far field. No
  // shading-normal step: on the raster's staircase it read as dashes.
  const on = GROUND_DETAIL;
  const k = smoothstep(0.15, 0.35, g.kerbOk).mul(g.near).mul(on).toVar();
  const top = gdBand(g.dr, -0.25, 0, g.w);
  const gutter = gdBand(g.dr, 0, 0.35, g.w);
  const c = col.baseCol;
  c.assign(
    mix(c, max(c.mul(1.08), vec3(0.78, 0.76, 0.72)), top.mul(k).mul(0.8))
  );
  c.mulAssign(
    float(1)
      .sub(gutter.mul(k).mul(0.14))
      .sub(gdBand(g.dr, 0, 0.08, g.w).mul(k).mul(0.08))
  );
  // The kerb's own shadow on the road. A 12 cm step throws a shadow a few
  // centimetres to a metre long — below what the shadow map resolves
  // (7 cm texels spread by the soft PCF, less the depth bias). Drawn from
  // the sun instead: when the sun stands behind the kerb, the road strip
  // out to H · cot(elevation) across the kerb is in its shade.
  const sun = inp.sunDirection;
  const sunH = vec2(sun.x, sun.z.negate()); // data frame (x east, y north)
  const behind = max(dot(sunH, g.intoRoad).negate(), 0);
  const reach = min(behind.mul(KERB_HEIGHT).div(max(sun.y, 0.05)), 1.5);
  const cast = gdBand(g.dr, -0.01, reach, max(g.w, 0.02)).mul(
    step(0.02, sun.y)
  );
  c.mulAssign(float(1).sub(cast.mul(k).mul(0.28)));
}

/** Lawn edge: a darker lip and a kink where the grass stops. */
function lawnEdge(inp: GroundInputs, col: GroundColour, g: GroundFields): void {
  const on = GROUND_DETAIL;
  const lip = gdBand(g.dl, 0, 0.25, g.w).mul(g.near).mul(on);
  col.baseCol.mulAssign(float(1).sub(lip.mul(0.12)));
  g.tilt.addAssign(
    toView(g.outOfLawn).mul(
      gdBand(g.dl, -0.02, 0.1, max(g.w, 0.025)).mul(g.near).mul(on).mul(0.5)
    )
  );
}

/**
 * The street's own frame: q.x along it (the bake's distance along the way,
 * so bays and stone rows bend with the street), q.y across it (the kerb
 * distance near a road, which follows the kerb round a bend; else across
 * the bearing in 5° steps about the data origin, which keeps a straight
 * path seamless).
 */
function streetFrame(inp: GroundInputs, g: GroundFields): V2 {
  const step5 = Math.PI / 36;
  const hq = floor(g.head.div(step5).add(0.5)).mul(step5);
  const aq = vec2(cos(hq), sin(hq)).toVar();
  const q = vec2(
    dot(inp.xy, aq),
    dot(inp.xy, vec2(aq.y.negate(), aq.x))
  ).toVar();
  If(g.hasFrame, () => {
    q.assign(vec2(g.alongM, q.y));
  });
  if (g.hasEdge) {
    If(abs(g.dr).lessThan(6), () => {
      q.assign(vec2(q.x, g.dr));
    });
  }
  return q;
}

/** The paving patterns, by kind. */
function paving(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  q: V2,
  pave: F
): void {
  const c = col.baseCol;
  const { xy } = inp;
  If(g.kind.equal(id("asphalt")), () => {
    const n = gdNoise(xy.mul(1.7))
      .mul(0.6)
      .add(gdNoise(xy.mul(0.31)).mul(0.4));
    c.mulAssign(
      float(1)
        .sub(pave.mul(0.03))
        .mul(n.sub(0.5).mul(0.08).mul(g.mid).mul(pave).add(1))
    );
  })
    .ElseIf(g.kind.equal(id("concrete")), () => {
      const size = vec2(5.5, 3.0);
      const j = gdJoint(q, size, 0.015, g.w);
      const h = gdHash(floor(q.div(size).add(0.5)));
      c.mulAssign(
        pave
          .mul(0.03)
          .add(1)
          .mul(h.sub(0.5).mul(0.05).mul(g.mid).mul(pave).add(1))
          .mul(float(1).sub(j.mul(0.14).mul(g.fine).mul(pave)))
      );
    })
    .ElseIf(g.kind.equal(id("paving")), () => {
      // a sanded path the class alone names takes the slabs' place along
      // its smooth edge (`smoothPaths`), not along the class texels' stairs
      const w = pave.mul(float(1).sub(byClass(g, col.path))).toVar();
      const size = vec2(0.5, 0.35);
      const row = floor(q.y.div(0.35).add(0.5));
      const qb = q.add(vec2(fract(row.mul(0.5)).mul(0.5), 0)).toVar(); // running bond
      const j = gdJoint(qb, size, 0.01, g.w);
      const h = gdHash(floor(qb.div(size).add(0.5)));
      c.mulAssign(
        h
          .sub(0.5)
          .mul(0.04)
          .mul(g.fine)
          .mul(w)
          .add(1)
          .mul(float(1).sub(j.mul(0.09).mul(g.fine).mul(w)))
      );
    })
    .ElseIf(g.kind.equal(id("sett")), () => {
      // Abstracted: a warmer, darker tone and a fine, direction-free grain
      // at stone size — cobbles as a texture of the ground, not as drawn
      // stones. A drawn stone grid with pillow shading read as busy up
      // close and seamed where two streets' frames met.
      const n = gdNoise(xy.div(0.16))
        .mul(0.65)
        .add(gdNoise(xy.div(0.5).add(17)).mul(0.35));
      c.mulAssign(
        mix(vec3(1), vec3(0.95, 0.94, 0.93), pave).mul(
          n.sub(0.5).mul(0.07).mul(g.fine).mul(pave).add(1)
        )
      );
    })
    .ElseIf(g.kind.equal(id("grass")), () => {
      const size = vec2(0.55, 0.4);
      const cell = q.div(size).toVar();
      const uv = abs(cell.sub(floor(cell.add(0.5))));
      const hole = float(1).sub(smoothstep(0.28, 0.32, max(uv.x, uv.y)));
      const green = mix(float(0.3), hole.mul(0.8), g.fine);
      c.assign(mix(c, inp.meadowColor, green.mul(pave)));
    });
  // A sanded path: the raster's own (weight 1), else the class's — which
  // follows the smooth edge `smoothPaths` cut, across the class texels
  // beside it too, so no tooth of the stairs shows.
  // On the carriageway: an unpaved road (its own kind, whole).
  const walk = walkGround(inp, col);
  const sand = select(
    g.onRoad,
    select(g.kind.equal(id("unpaved")), float(1), float(0)),
    clamp(g.sandW.mul(walk).add(col.path.mul(float(1).sub(g.walkW))), 0, 1)
  )
    .mul(pave)
    .toVar();
  If(sand.greaterThan(0), () => {
    const n = gdNoise(xy.mul(3.1))
      .mul(0.5)
      .add(gdNoise(xy.mul(0.7)).mul(0.5));
    c.mulAssign(
      mix(vec3(1), vec3(1.03, 1.0, 0.92), sand).mul(
        n.sub(0.5).mul(0.1).mul(g.mid).mul(sand).add(1)
      )
    );
  });
}

/** A painted line's half-width (m). */
const LINE = 0.07;

/**
 * A street's parking band across the kerb on this texel (`parkingBand` in
 * lib/city/landcover.ts): `from`/`to` in metres from the kerb (+ toward the
 * road) — on the carriageway, a metre over the kerb, or a bay's depth onto
 * the pavement — and the bays' depth and length (vars).
 */
export function parkingBandOf(g: GroundFields): {
  bay: F;
  depth: F;
  from: F;
  street: B;
  to: F;
} {
  const parallel = g.park.equal(parkingId("street-parallel"));
  const street = or(
    parallel,
    g.park.equal(parkingId("street-perpendicular"))
  ).toVar();
  const depth = select(
    parallel,
    PARKING_DEPTH.parallel,
    PARKING_DEPTH.angled
  ).toVar();
  const from = select(
    g.parkPlace.equal(parkingPlaceId("on-kerb")),
    depth.negate(),
    select(g.parkPlace.equal(parkingPlaceId("half-on-kerb")), -1, 0)
  ).toVar();
  return {
    bay: select(parallel, 5.5, 2.5).toVar(), // m along the street
    depth,
    from,
    street,
    to: from.add(depth).toVar(),
  };
}

/**
 * Parking: a street's parking lane laid out from the kerb, or bay lines
 * across a car park. A street's bays lie on the carriageway, over the kerb
 * by a metre or on the pavement (the paving raster's place); their lines —
 * the dividers and the outer edge — are drawn only where OSM says they are
 * painted, elsewhere the lane is a faint tint (QA B23: the orthophotos show
 * almost no painted bays). A lot is painted unless OSM says not, or it is
 * gravel or grass.
 */
function parking(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  q: V2
): void {
  const paint = float(0).toVar();
  const lot = () => {
    // Bays side by side along the aisle (the direction), 2.5 m wide; the
    // bake clears the aisles themselves.
    const e = abs(fract(q.x.div(2.5).add(0.5)).sub(0.5)).mul(2.5);
    paint.assign(
      float(1).sub(smoothstep(g.w.negate().add(LINE), g.w.add(LINE), e))
    );
  };
  const paintedLot = and(g.park.equal(parkingId("lot")), g.parkPainted);
  if (g.hasEdge) {
    const band = parkingBandOf(g);
    If(band.street, () => {
      const lane = gdBand(g.dr, band.from, band.to, g.w).toVar();
      // the bays' outer line: on the road, or for bays on the pavement
      // their far side
      const outer = select(
        g.parkPlace.equal(parkingPlaceId("on-kerb")),
        band.from,
        band.to
      );
      const edge = gdBand(g.dr, outer.sub(LINE), outer.add(LINE), g.w);
      const e = abs(fract(q.x.div(band.bay).add(0.5)).sub(0.5)).mul(band.bay);
      const sep = float(1).sub(
        smoothstep(g.w.negate().add(LINE), g.w.add(LINE), e)
      );
      If(g.parkPainted, () => {
        paint.assign(max(edge, sep.mul(lane)));
      });
      col.baseCol.mulAssign(
        float(1).sub(lane.mul(0.03).mul(g.mid).mul(GROUND_DETAIL))
      );
    }).ElseIf(paintedLot, lot);
  } else {
    If(paintedLot, lot);
  }
  const fade = float(1).sub(smoothstep(0.06, 0.25, inp.fw));
  const amount = paint.mul(fade).mul(GROUND_DETAIL).mul(0.8).toVar();
  col.baseCol.assign(
    mix(col.baseCol, max(col.baseCol, vec3(0.86, 0.85, 0.82)), amount)
  );
  col.paperInk.assign(max(col.paperInk, amount));
}

/** Kerbs, lawn edges and the paving patterns (after `urbanGreen`). */
export function groundDetail(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  ugW: F
): void {
  kerb(inp, col, g);
  lawnEdge(inp, col, g);
  const q = streetFrame(inp, g);
  const pave = GROUND_DETAIL.mul(float(1).sub(ugW)).toVar();
  // Sealed ground off the carriageway (a car park, an asphalt path, a
  // concreted yard) takes on the road's grey, so it reads from afar too.
  // Its share of the texels round the fragment, so a sealed path's edge
  // (and a sealed texel among a path's sanded ones) fades, not steps.
  const sealedW = g.sealedW.mul(walkGround(inp, col)).toVar();
  If(and(g.onRoad.not(), sealedW.greaterThan(0)), () => {
    const tone = select(g.kind.equal(id("concrete")), 1.08, 1.0);
    col.baseCol.assign(
      mix(col.baseCol, inp.roadColor.mul(tone), pave.mul(0.6).mul(sealedW))
    );
  });
  // A path's stray class texel off its smooth edge is paved as the ground
  // beside it, so the slabs run on unbroken under the path's edge.
  If(
    and(
      g.walkKind.equal(0),
      g.onRoad.not(),
      int(inp.cls).equal(PATH_CLASS),
      col.pathSide.equal(BUILTUP_CLASS)
    ),
    () => {
      g.kind.assign(id("paving"));
    }
  );
  paving(inp, col, g, q, pave);
  parking(inp, col, g, q);
}

/** Folds the accumulated normal tilt in (after the meadow's normal). */
export const groundNormal = (normal: V3, tilt: V3): V3 =>
  normalize(normal.add(tilt));
