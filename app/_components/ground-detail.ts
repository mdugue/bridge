import type { Node, Texture, UniformNode, Vector3 } from "three/webgpu";
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
import type { F, Live, V2, V3, V4 } from "./shader-chunks";

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

type I = Node<"int">;
type I2 = Node<"ivec2">;
type B = Node<"bool">;

/** What every ground chunk reads (the terrain's colour node makes it). */
export interface GroundInputs {
  /** the splat uv (v grows southward), a var */
  uv: V2;
  /** the fragment's data-frame XY (m), a var */
  xy: V2;
  /** the tile's size (m) */
  size: [number, number];
  /** the NEAREST class-id raster */
  classTexture: Texture;
  /** metres per pixel (the larger fwidth of `xy`), a var */
  fw: F;
  /** the class id at the fragment (float), a var */
  cls: F;
  /** the look rows (shared uniform nodes) */
  groundDetail: Live;
  urbanGreen: Live;
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
  /** the street bearing (rad from east) and whether the paving raster
   *  gives the street's frame here, with the distance along it */
  head: F;
  hasFrame: B;
  alongM: F;
  onRoad: B;
  /** the paving kind (surfaceId) */
  kind: I;
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
export const texelSize = (t: Texture, uv: V2): I2 =>
  // reason: TextureSizeNode is typed as a bare Node; it is a uvec2.
  ivec2(textureSize(texture(t, uv), int(0)) as unknown as Node<"uvec2">);

// reason: TSL's clamp runs on integer vectors (WGSL clamp on vec2<i32>),
// but its typings only cover float ones.
const clampI2 = clamp as unknown as (x: I2, lo: I2, hi: I2) => I2;

/** The texel at `p`, clamped into the raster (`size` from `texelSize`). */
export const texelAt = (t: Texture, p: I2, size: I2): V4 =>
  textureLoad(t, clampI2(p, ivec2(0, 0), size.sub(ivec2(1, 1))));

/** The texel at `p` of a table texture (the row lookups: always inside). */
export const loadTexel = (t: Texture, p: I2): V4 => textureLoad(t, p);

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

/** ground a kerb borders: background, meadow, forest, copse, built-up, path */
const kerbable = (c: I): F =>
  select(or(c.lessThanEqual(BUILTUP_CLASS), c.equal(PATH_CLASS)), 1, 0);

const isClass = (c: I, k: number): F => select(c.equal(k), 1, 0);

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
      lawn.push(isClass(c, MEADOW_CLASS));
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
const edgeAt = (edges: Texture, uv: V2): V2 =>
  texture(edges, uv).level(float(0)).rg.mul(255).sub(128).div(EDGE_SCALE);

/** The baked distances: valid out to ±6 m, straight along a diagonal kerb,
 *  with their gradient (central differences, uv grows south). */
function bakedDistances(inp: GroundInputs, edges: Texture, g: GroundFields) {
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
  If(and(inp.fw.lessThan(0.5), inp.groundDetail.greaterThan(0)), () => {
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
function pavingFields(inp: GroundInputs, surface: Texture, g: GroundFields) {
  const ss = texelSize(surface, inp.uv).toVar();
  const s = texelAt(surface, ivec2(inp.uv.mul(vec2(ss))), ss).toVar();
  const byte = int(byteOf(s.r)).toVar();
  g.roadKind.assign(byte.bitAnd(7));
  g.walkKind.assign(byte.shiftRight(3).bitAnd(7));
  g.park.assign(byte.shiftRight(6));
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
      .add(byteOf(s.a).mul(256))
      .div(65536)
      .mul(ALONG_PERIOD);
    g.alongM.assign(
      floorMod(
        offset.add(dot(g.local, vec2(cos(g.head), sin(g.head)))),
        ALONG_PERIOD
      )
    );
  });
}

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
 * paving kind and the street direction. After the meadow mottle.
 */
export function groundFields(
  inp: GroundInputs,
  surface?: Texture,
  edges?: Texture
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
  const lawn = gdField(
    four((c) => isClass(c, MEADOW_CLASS)),
    f,
    mpt
  ).toVar();
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
    head: float(0).toVar(),
    hasFrame: bool(false).toVar(),
    alongM: float(0).toVar(),
    onRoad: bool(false),
    kind: int(0),
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
  if (surface) {
    pavingFields(inp, surface, g);
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
 * meadow); without, the NDVI decides here. Returns its weight (`ugW`).
 */
export function urbanGreen(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  ndvi?: Texture
): F {
  const cls = int(inp.cls);
  const built = select(or(cls.equal(BUILTUP_CLASS), cls.equal(0)), 1, 0);
  let mask: F = float(0);
  if (g.hasEdge) {
    mask = smoothstep(-0.15, 0.15, g.dl).mul(built);
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
  const strength = ndvi || g.hasEdge ? inp.urbanGreen : float(0);
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
  const on = inp.groundDetail;
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
  const on = inp.groundDetail;
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
          .mul(pave)
          .add(1)
          .mul(float(1).sub(j.mul(0.09).mul(g.fine).mul(pave)))
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
    .ElseIf(g.kind.equal(id("unpaved")), () => {
      const n = gdNoise(xy.mul(3.1))
        .mul(0.5)
        .add(gdNoise(xy.mul(0.7)).mul(0.5));
      c.mulAssign(
        mix(vec3(1), vec3(1.03, 1.0, 0.92), pave).mul(
          n.sub(0.5).mul(0.1).mul(g.mid).mul(pave).add(1)
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
}

/** A painted line's half-width (m). */
const LINE = 0.07;

/** Parking: bay lines laid out from the kerb, or across a car park. */
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
  const isLot = g.park.equal(parkingId("lot"));
  if (g.hasEdge) {
    const street = or(
      g.park.equal(parkingId("street-parallel")),
      g.park.equal(parkingId("street-perpendicular"))
    );
    If(and(g.onRoad, street), () => {
      const parallel = g.park.equal(parkingId("street-parallel"));
      const depth = select(parallel, 2.0, 5.0).toVar(); // m from the kerb
      const bay = select(parallel, 5.5, 2.5).toVar(); // m along the street
      const lane = gdBand(g.dr, 0, depth, g.w).toVar();
      const edge = gdBand(g.dr, depth.sub(LINE), depth.add(LINE), g.w);
      const e = abs(fract(q.x.div(bay).add(0.5)).sub(0.5)).mul(bay);
      const sep = float(1).sub(
        smoothstep(g.w.negate().add(LINE), g.w.add(LINE), e)
      );
      paint.assign(max(edge, sep.mul(lane)));
      col.baseCol.mulAssign(
        float(1).sub(lane.mul(0.03).mul(g.mid).mul(inp.groundDetail))
      );
    }).ElseIf(isLot, lot);
  } else {
    If(isLot, lot);
  }
  const fade = float(1).sub(smoothstep(0.06, 0.25, inp.fw));
  col.baseCol.assign(
    mix(
      col.baseCol,
      max(col.baseCol, vec3(0.86, 0.85, 0.82)),
      paint.mul(fade).mul(inp.groundDetail).mul(0.8)
    )
  );
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
  const pave = inp.groundDetail.mul(float(1).sub(ugW)).toVar();
  // Sealed ground off the carriageway (a car park, an asphalt path, a
  // concreted yard) takes on the road's grey, so it reads from afar too.
  const sealed = or(g.kind.equal(id("asphalt")), g.kind.equal(id("concrete")));
  If(and(g.onRoad.not(), g.walkKind.greaterThan(0), sealed), () => {
    const tone = select(g.kind.equal(id("concrete")), 1.08, 1.0);
    col.baseCol.assign(
      mix(col.baseCol, inp.roadColor.mul(tone), pave.mul(0.6))
    );
  });
  paving(inp, col, g, q, pave);
  parking(inp, col, g, q);
}

/** Folds the accumulated normal tilt in (after the meadow's normal). */
export const groundNormal = (normal: V3, tilt: V3): V3 =>
  normalize(normal.add(tilt));
