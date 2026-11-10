/**
 * Where the clay's windows stand in space (app/_components/clay-windows.ts
 * draws them per fragment from the `_FACADE` attribute and the object's
 * window row): the same columns and rows, computed once per wall on the
 * CPU, so a real niche can stand behind each opening (window-niche-layer.ts).
 *
 * A mirror of the shader's `columns` and `grid`, from the same quantised
 * inputs — the attribute's snorm16 codes, the object table's floats — so a
 * niche sits where the shader cuts its opening. It is a superset on
 * purpose: it keeps the rows that fit and the columns on the wall, but not
 * what only hides an opening (a shop, a door, the ground in front): a niche
 * with no opening in front of it stays behind the wall, unseen, while an
 * opening with no niche behind it would be a hole into the building.
 */
import {
  DORMER_WINDOW,
  FACADE_SCALE_M,
  LOOSE_JITTER,
  MEASURED_AXES,
  WINDOW_DEPTH,
  WINDOW_LIFT,
  WINDOW_ROWS,
  WINDOW_SILL,
  WINDOW_STYLE,
  clearOfDoor,
  slotDoor,
  slotWallEave,
} from "./windows";

/** The object's window row as the clay reads it (the object table's band
 *  3, its storey, eave and jitter seed). */
export interface NicheObject {
  /** the windows' axis spacing, width, height (m) and style word */
  axis: number;
  w: number;
  h: number;
  style: number;
  /** storey height and eave over the base (m) */
  storey: number;
  eave: number;
  /** the per-building jitter in −1…1 (the table's `rough`) */
  seed: number;
}

/** One opening on a wall, in the wall's own terms: its axis along the wall
 *  from the wall's middle (as `_FACADE` counts it) and its sill and head
 *  over the object's base (m), its half width and its reveal's depth. */
export interface WallOpening {
  s: number;
  half: number;
  v0: number;
  v1: number;
  depth: number;
  /** its column and storey, as the shader counts them (its hashes) */
  j: number;
  k: number;
}

const bit = (style: number, b: number) => Math.floor(style / b) % 2;
const f32 = Math.fround;

/** The jitter's hash, as the shader takes it: no sine (a GPU's differs
 *  from the CPU's), a golden-ratio step over the column and the seed. */
export function jitterHash(j: number, seed: number): number {
  const x = f32(f32(j * f32(0.618034)) + f32(seed * f32(0.7548777)));
  return x - Math.floor(x);
}

/** The columns of a wall whose length slot holds `lengthCode` (snorm16,
 *  signed): their axes from the wall's middle (m) and the window's width. */
export function wallColumns(
  o: NicheObject,
  lengthCode: number
): { centres: number[]; w: number } {
  const units = Math.abs(lengthCode);
  const measured = units >= MEASURED_AXES.base;
  const code = Math.max(units - MEASURED_AXES.base, 0);
  const nMeasured = Math.floor((code + 0.5) / MEASURED_AXES.perN);
  const axis = measured
    ? (code - nMeasured * MEASURED_AXES.perN) * MEASURED_AXES.step +
      MEASURED_AXES.axis0
    : Math.max(o.axis, 0.1);
  const w = measured ? Math.min(o.w, axis - WINDOW_ROWS.gap) : o.w;
  const style = Math.floor(o.style + 0.5);
  const dormer = bit(style, WINDOW_STYLE.dormer) === 1;
  const edge = dormer ? DORMER_WINDOW.edge : WINDOW_ROWS.edge;
  const length = (units / 32_767) * FACADE_SCALE_M;
  const room = length - 2 * edge - w;
  let n: number;
  if (measured) {
    n = nMeasured;
  } else {
    n = room >= 0 ? Math.floor(Math.max(room, 0) / axis + 1e-4) + 1 : 0;
  }
  if (o.axis < 0.05 || length < 0.5 || n < 1) {
    return { centres: [], w };
  }
  const off = (n - 1) / 2;
  const free = Math.min(
    Math.max((axis - w - WINDOW_ROWS.gap) / 2, 0),
    axis * LOOSE_JITTER
  );
  const loose = bit(style, WINDOW_STYLE.loose) === 1 && !measured;
  const centres: number[] = [];
  for (let j = 0; j < n; j += 1) {
    const jitter = loose ? (jitterHash(j, o.seed) * 2 - 1) * free : 0;
    centres.push((j - off) * axis + jitter);
  }
  return { centres, w };
}

/** The rows on a wall up to `topH` m over the base whose second door slot
 *  holds `eaveCode` (its own eave, `WALL_EAVE`): each row's sill and head
 *  over the base (m) — the ground floor's only where it fits under the
 *  first storey line, as the shader's. */
export function wallRows(
  o: NicheObject,
  eaveCode: number,
  topH: number
): { v0: number; v1: number; k: number }[] {
  const style = Math.floor(o.style + 0.5);
  const dormer = bit(style, WINDOW_STYLE.dormer) === 1;
  const sill = dormer
    ? DORMER_WINDOW.sill
    : WINDOW_SILL.base +
      (Math.floor(style / WINDOW_STYLE.sill) % WINDOW_SILL.classes) *
        WINDOW_SILL.step;
  const storey = Math.max(o.storey, 0.5);
  const first = Math.max(storey, WINDOW_ROWS.firstLine);
  const tall = Math.min(o.h, storey - sill - WINDOW_ROWS.lintel);
  const eave = o.eave + slotWallEave(eaveCode);
  const top = eave - (dormer ? DORMER_WINDOW.eaveClear : WINDOW_ROWS.eaveClear);
  const lift =
    (Math.floor(style / WINDOW_STYLE.lift) % WINDOW_LIFT.classes) *
    WINDOW_LIFT.step;
  const rows: { v0: number; v1: number; k: number }[] = [];
  // a row past a broken object's numbers would never end the loop
  if (!(Number.isFinite(topH) && Number.isFinite(first + storey))) {
    return rows;
  }
  for (let k = 0; ; k += 1) {
    const line = k === 0 ? 0 : first + (k - 1) * storey;
    if (line > topH) {
      break;
    }
    const up = k === 0 ? lift : 0;
    const height = Math.min(line + sill + tall, top) - line - sill - up;
    const fits = k > 0 || sill + tall <= first - WINDOW_ROWS.lintel;
    if (height >= WINDOW_ROWS.min && fits) {
      rows.push({ v0: line + sill + up, v1: line + sill + up + height, k });
    }
  }
  return rows;
}

/** The reveal's depth of an object's windows (m, `WINDOW_DEPTH`). */
export function revealDepth(style: number): number {
  const s = Math.floor(style + 0.5);
  return (
    WINDOW_DEPTH.base +
    (Math.floor(s / WINDOW_STYLE.depth) % WINDOW_DEPTH.classes) *
      WINDOW_DEPTH.step
  );
}

/** Every opening a wall may show: its columns × its rows (a superset of
 *  what the shader draws, see the head comment). `doors`: the wall's two
 *  door slots (`_FACADE` z and w, as integers): no ground-floor opening
 *  within `DOOR_GAP_M` of a door they hold, as the clay's `doorClear` —
 *  a passage's portal among them, a real hole a niche would show in. */
export function wallOpenings(
  o: NicheObject,
  lengthCode: number,
  eaveCode: number,
  topH: number,
  doors: readonly number[] = []
): WallOpening[] {
  const { centres, w } = wallColumns(o, lengthCode);
  if (centres.length === 0) {
    return [];
  }
  const depth = revealDepth(o.style);
  // a wall whose ground floor has no windows (a shopfront's, its windows
  // real holes in the wall; one buried, one with many doors) is signed:
  // no niche there, where one could reach into a shop window
  const rows = wallRows(o, eaveCode, topH).filter(
    (r) => lengthCode > 0 || r.k > 0
  );
  const placed = doors.flatMap((code) => slotDoor(code) ?? []);
  return centres.flatMap((s, j) =>
    rows
      .filter((r) => r.k > 0 || placed.every((d) => clearOfDoor(s, w, d)))
      .map((r) => ({
        s,
        half: w / 2,
        v0: r.v0,
        v1: r.v1,
        depth,
        j,
        k: r.k,
      }))
  );
}

/** What `tileNiches` reads of a city mesh: per vertex its place (Y-up
 *  scene frame), its `_FACADE` codes (snorm16, as integers) and its object;
 *  per triangle its first vertex (non-indexed or by `index`). */
export interface NicheMesh {
  positions: ArrayLike<number>;
  facade: ArrayLike<number>;
  objectIds: ArrayLike<number>;
  index?: ArrayLike<number>;
}

/** Floats per niche in `tileNiches`' output: centre x, y, z (scene, the
 *  opening's middle on the wall's plane), the wall's outward normal x and
 *  z, half width, half height, depth, object, and its column and storey
 *  as the shader counts them (its night hash, which the niche's pane
 *  reads again on the GPU). */
export const NICHE_STRIDE = 11;

/** A wall gathered from its triangles: its object, codes, plane and the
 *  (s, h) corners of its triangles. */
interface NicheWall {
  object: number;
  length: number;
  /** its door slots: the first, and the second (a door or its eave) */
  door: number;
  eave: number;
  nx: number;
  nz: number;
  /** a point on it (scene) and its `s` there */
  px: number;
  pz: number;
  s0: number;
  /** its triangles in (s, y) */
  tris: number[];
  top: number;
}

/** A triangle's horizontal normal in the scene frame, as long as its
 *  area's horizontal share (twice it), or undefined when it is no wall (as
 *  upright as the clay's `wall` term may still cut). */
function uprightNormal(
  p: ArrayLike<number>,
  a: number,
  b: number,
  c: number
): { x: number; z: number } | undefined {
  const e1 = [
    p[3 * b] - p[3 * a],
    p[3 * b + 1] - p[3 * a + 1],
    p[3 * b + 2] - p[3 * a + 2],
  ];
  const e2 = [
    p[3 * c] - p[3 * a],
    p[3 * c + 1] - p[3 * a + 1],
    p[3 * c + 2] - p[3 * a + 2],
  ];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  const len = Math.hypot(nx, ny, nz);
  // the clay's wall: |n.y| under 0.7 (its weight 1 − smoothstep(0.5,
  // 0.7)): every face the clay may cut, a superset
  if (len < 1e-9 || Math.abs(ny) > 0.7 * len || Math.hypot(nx, nz) < 1e-9) {
    return undefined;
  }
  return { x: nx, z: nz };
}

/** Whether (s, y) lies in one of a wall's triangles (a hair inside). */
function onWall(tris: readonly number[], s: number, y: number): boolean {
  for (let i = 0; i + 5 < tris.length; i += 6) {
    const ax = tris[i];
    const ay = tris[i + 1];
    const bx = tris[i + 2];
    const by = tris[i + 3];
    const cx = tris[i + 4];
    const cy = tris[i + 5];
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(d) < 1e-9) {
      continue;
    }
    const u = ((bx - s) * (cy - y) - (by - y) * (cx - s)) / d;
    const v = ((cx - s) * (ay - y) - (cy - y) * (ax - s)) / d;
    const eps = 1e-4;
    if (u >= -eps && v >= -eps && 1 - u - v >= -eps) {
      return true;
    }
  }
  return false;
}

const snormOf = (code: number) => code / 32_767;

/** A wall's triangles before they are told apart by plane: its codes,
 *  its normal summed over its triangles (area-weighted, horizontal), and
 *  their centroids' offsets from its first corner summed by the same
 *  weights (its mean plane). */
interface WallPiece {
  wall: NicheWall;
  sx: number;
  sz: number;
  ox: number;
  oz: number;
  weight: number;
}

/** Two pieces of one object with the same codes are one wall when they
 *  face the same way within this (cos) … */
const SAME_FACING_COS = Math.cos((2 * Math.PI) / 180);
/** … and their planes stand within this (m): the glTF's positions are
 *  quantised (3.4 cm), so one LoD2 wall's triangles disagree a little,
 *  while a U's wing ends or a house's front and back stand metres apart. */
const SAME_PLANE_M = 0.15;
/** … and their facade coordinate runs on: two wings either side of a
 *  risalit stand in one plane, each with its own `s` from its own end. */
const SAME_RUN_M = 0.25;

/** Whether a triangle (normal `n`, first vertex at `x, z` with facade
 *  coordinate `s`) belongs to `q`'s wall. */
function samePiece(
  q: WallPiece,
  n: { x: number; z: number },
  x: number,
  z: number,
  s: number
): boolean {
  const ql = Math.hypot(q.sx, q.sz);
  const unit = Math.hypot(n.x, n.z);
  if ((q.sx * n.x + q.sz * n.z) / (ql * unit) < SAME_FACING_COS) {
    return false;
  }
  // the corner's distance from q's plane, not the offsets' difference: a
  // hair's tilt of each triangle's own normal is metres of offset 1 km
  // from the origin
  if (
    Math.abs(q.sx * (x - q.wall.px) + q.sz * (z - q.wall.pz)) / ql >
    SAME_PLANE_M
  ) {
    return false;
  }
  // along the wall, t = (n.z, −n.x) (see tileNiches)
  const along = (-q.sz * (x - q.wall.px) + q.sx * (z - q.wall.pz)) / ql;
  return Math.abs(q.wall.s0 + along - s) <= SAME_RUN_M;
}

/** Gathers a city mesh's window-carrying walls by object, codes and plane
 *  (each wall's normal the mean of its triangles'). */
function gatherWalls(
  mesh: NicheMesh,
  objects: (object: number) => NicheObject | undefined,
  base: (object: number) => number
): NicheWall[] {
  const p = mesh.positions;
  const f = mesh.facade;
  const pieces = new Map<string, WallPiece[]>();
  const count = mesh.index ? mesh.index.length : mesh.objectIds.length;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = mesh.index ? mesh.index[t] : t;
    const b = mesh.index ? mesh.index[t + 1] : t + 1;
    const c = mesh.index ? mesh.index[t + 2] : t + 2;
    const object = mesh.objectIds[a];
    const length = f[4 * a + 1];
    // a party wall (0) has none; a roof vertex holds colours there
    if (length === 0 || f[4 * a + 2] === -32_767 || !objects(object)) {
      continue;
    }
    const n = uprightNormal(p, a, b, c);
    if (!n) {
      continue;
    }
    const key = `${object}:${length}:${f[4 * a + 2]}:${f[4 * a + 3]}`;
    const list = pieces.get(key) ?? [];
    pieces.set(key, list);
    const unit = Math.hypot(n.x, n.z);
    const s = snormOf(f[4 * a]) * FACADE_SCALE_M;
    let piece = list.find((q) => samePiece(q, n, p[3 * a], p[3 * a + 2], s));
    if (!piece) {
      piece = {
        wall: {
          object,
          length,
          door: f[4 * a + 2],
          eave: f[4 * a + 3],
          nx: 0,
          nz: 0,
          px: p[3 * a],
          pz: p[3 * a + 2],
          s0: s,
          tris: [],
          top: Number.NEGATIVE_INFINITY,
        },
        sx: 0,
        sz: 0,
        ox: 0,
        oz: 0,
        weight: 0,
      };
      list.push(piece);
    }
    piece.sx += n.x;
    piece.sz += n.z;
    // (its centroid's offset)
    const mx = (p[3 * a] + p[3 * b] + p[3 * c]) / 3;
    const mz = (p[3 * a + 2] + p[3 * b + 2] + p[3 * c + 2]) / 3;
    piece.ox += (mx - piece.wall.px) * unit;
    piece.oz += (mz - piece.wall.pz) * unit;
    piece.weight += unit;
    const z0 = base(object);
    for (const v of [a, b, c]) {
      const h = p[3 * v + 1] - z0;
      piece.wall.tris.push(snormOf(f[4 * v]) * FACADE_SCALE_M, h);
      piece.wall.top = Math.max(piece.wall.top, h);
    }
  }
  return [...pieces.values()].flatMap((list) =>
    list.map(({ wall, sx, sz, ox, oz, weight }) => {
      const l = Math.hypot(sx, sz) || 1;
      const nx = sx / l;
      const nz = sz / l;
      // anchored on the wall's mean plane, not on one quantised vertex's
      const off = (nx * ox + nz * oz) / (weight || 1);
      return {
        ...wall,
        nx,
        nz,
        px: wall.px + nx * off,
        pz: wall.pz + nz * off,
      };
    })
  );
}

/**
 * The niches of a city tile: per window the shader may cut into a wall,
 * where it stands (`NICHE_STRIDE` floats each). `objects` gives a
 * window-carrying object's row (undefined: none), `base` its base (scene
 * y). An opening none of whose middle and corners lies on its wall's
 * triangles is left out (the shader cuts nothing there).
 */
export function tileNiches(
  mesh: NicheMesh,
  objects: (object: number) => NicheObject | undefined,
  base: (object: number) => number
): Float32Array {
  const out: number[] = [];
  // one row per object, not per triangle (`nichesOf`' reader builds one)
  const rows = new Map<number, NicheObject | undefined>();
  const rowOf = (object: number) => {
    if (!rows.has(object)) {
      rows.set(object, objects(object));
    }
    return rows.get(object);
  };
  for (const w of gatherWalls(mesh, rowOf, base)) {
    const o = rowOf(w.object);
    if (!o) {
      continue;
    }
    // along the wall: t = (n.z, −n.x) in the scene's (x, z) — the data
    // frame's (n.y, −n.x) with z = −y
    const tx = -w.nz;
    const tz = w.nx;
    for (const op of wallOpenings(o, w.length, w.eave, w.top, [
      w.door,
      w.eave,
    ])) {
      const mid = (op.v0 + op.v1) / 2;
      // any of its middle and corners (a hair in) on the wall: a niche
      // too many stays unseen behind it, one too few is a hole
      const ins = Math.max(op.half - 0.01, 0);
      const inv = Math.max((op.v1 - op.v0) / 2 - 0.01, 0);
      const probes = [
        [0, 0],
        [-ins, -inv],
        [ins, -inv],
        [-ins, inv],
        [ins, inv],
      ];
      if (!probes.some(([ds, dv]) => onWall(w.tris, op.s + ds, mid + dv))) {
        continue;
      }
      const ds = op.s - w.s0;
      out.push(
        w.px + tx * ds,
        base(w.object) + mid,
        w.pz + tz * ds,
        w.nx,
        w.nz,
        op.half,
        (op.v1 - op.v0) / 2,
        op.depth,
        w.object,
        op.j,
        op.k
      );
    }
  }
  return Float32Array.from(out);
}

/** The side of a niche cell (m): what the niches near the eye are found by. */
export const NICHE_CELL_M = 32;

/** A cell's key from its column and row (each within ±2¹⁵ cells). */
export const nicheCellKey = (cx: number, cz: number): number =>
  (cx + 32_768) * 65_536 + (cz + 32_768);

/**
 * A tile's niches sorted by their cell (`NICHE_CELL_M`, scene x and z):
 * the sorted list, and per cell its key, first niche and end (triples).
 */
export function cellNiches(niches: Float32Array): {
  niches: Float32Array;
  cells: Float64Array;
} {
  const n = niches.length / NICHE_STRIDE;
  const keys = new Float64Array(n);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * NICHE_STRIDE;
    keys[i] = nicheCellKey(
      Math.floor(niches[o] / NICHE_CELL_M),
      Math.floor(niches[o + 2] / NICHE_CELL_M)
    );
    order[i] = i;
  }
  order.sort((a, b) => keys[a] - keys[b]);
  const sorted = new Float32Array(niches.length);
  const cells: number[] = [];
  for (let r = 0; r < n; r += 1) {
    const i = order[r];
    sorted.set(
      niches.subarray(i * NICHE_STRIDE, (i + 1) * NICHE_STRIDE),
      r * NICHE_STRIDE
    );
    if (r === 0 || keys[i] !== keys[order[r - 1]]) {
      if (r > 0) {
        cells.push(r);
      }
      cells.push(keys[i], r);
    }
  }
  if (n > 0) {
    cells.push(n);
  }
  return { niches: sorted, cells: Float64Array.from(cells) };
}

/** The object table's columns a tile's niches read (city-mesh.ts
 *  `CityObjectTable`, the floats the clay reads of it). */
export interface NicheTable {
  baseZ: Float32Array;
  /** each object's root Building (`CityObjectTable.root`): its house */
  root: Uint32Array;
  eaveH: Float32Array;
  rough: Float32Array;
  storeyH: Float32Array;
  winAxis: Float32Array;
  winH: Float32Array;
  winStyle: Uint32Array;
  winW: Float32Array;
}

/** Unsigned 16-bit words per packed niche (`packNiches`): 16 bytes where
 *  `NICHE_STRIDE` floats take 44 — what a phone keeps of a tile. */
export const PACKED_STRIDE = 8;

/** A niche's depth in 2 mm steps: up to 0.51 m, past the deepest reveal
 *  (`WINDOW_DEPTH`, 0.27 m), which millimetres in a byte cut short. */
const DEPTH_UNITS = 500;
const clampTo = (v: number, top: number) =>
  Math.min(Math.max(Math.round(v), 0), top);
/** A niche's sizes in 2 cm steps, rounded up: never smaller than its
 *  opening (window-niche-layer.ts lets the box reach past it besides). */
const SIZE_STEP_M = 0.02;
const size = (m: number) => Math.min(Math.ceil(m / SIZE_STEP_M - 1e-6), 255);

/**
 * A tile's niches (sorted by cell, `cellNiches`) packed into 16-bit words:
 * its place in its cell and its middle over its object's base (cm), its
 * wall's facing (an angle), its half width and half height (2 cm, rounded
 * up), its depth (2 mm), column, storey and object (24 bits).
 */
export function packNiches(
  niches: Float32Array,
  baseZ: ArrayLike<number>
): Uint16Array {
  const n = niches.length / NICHE_STRIDE;
  const out = new Uint16Array(n * PACKED_STRIDE);
  for (let i = 0; i < n; i += 1) {
    const f = i * NICHE_STRIDE;
    const o = i * PACKED_STRIDE;
    const x = niches[f];
    const z = niches[f + 2];
    const object = niches[f + 8];
    const angle = Math.atan2(niches[f + 4], niches[f + 3]);
    out[o] = clampTo(
      (x - Math.floor(x / NICHE_CELL_M) * NICHE_CELL_M) * 100,
      65_535
    );
    out[o + 1] = clampTo(
      (z - Math.floor(z / NICHE_CELL_M) * NICHE_CELL_M) * 100,
      65_535
    );
    out[o + 2] = clampTo((niches[f + 1] - baseZ[object]) * 100, 65_535);
    out[o + 3] = clampTo(((angle + Math.PI) / (2 * Math.PI)) * 65_536, 65_535);
    out[o + 4] = size(niches[f + 5]) * 256 + size(niches[f + 6]);
    out[o + 5] =
      clampTo(niches[f + 7] * DEPTH_UNITS, 255) * 256 +
      clampTo(niches[f + 9], 255);
    out[o + 6] =
      clampTo(niches[f + 10], 255) * 256 + Math.floor(object / 65_536);
    out[o + 7] = object % 65_536;
  }
  return out;
}

/** One packed niche back as its `NICHE_STRIDE` floats into `out`, from the
 *  cell it lies in (`cx`, `cz`) and its object's base. */
export function unpackNiche(
  p: Uint16Array,
  i: number,
  cx: number,
  cz: number,
  baseZ: ArrayLike<number>,
  out: Float32Array
): Float32Array {
  const o = i * PACKED_STRIDE;
  const object = (p[o + 6] % 256) * 65_536 + p[o + 7];
  const angle = (p[o + 3] / 65_536) * 2 * Math.PI - Math.PI;
  out[0] = cx * NICHE_CELL_M + p[o] / 100;
  out[1] = baseZ[object] + p[o + 2] / 100;
  out[2] = cz * NICHE_CELL_M + p[o + 1] / 100;
  out[3] = Math.cos(angle);
  out[4] = Math.sin(angle);
  out[5] = Math.floor(p[o + 4] / 256) * SIZE_STEP_M;
  out[6] = (p[o + 4] % 256) * SIZE_STEP_M;
  out[7] = Math.floor(p[o + 5] / 256) / DEPTH_UNITS;
  out[8] = object;
  out[9] = p[o + 5] % 256;
  out[10] = Math.floor(p[o + 6] / 256);
  return out;
}

/** A tile's niches from its mesh and table, sorted by cell (`cellNiches`)
 *  and packed (`packNiches`). */
export function nichesOf(
  mesh: NicheMesh,
  t: NicheTable
): { niches: Uint16Array; cells: Float64Array; houses: Float32Array } {
  const objects = (i: number): NicheObject | undefined =>
    i < t.winAxis.length && t.winAxis[i] >= 0.05
      ? {
          axis: t.winAxis[i],
          w: t.winW[i],
          h: t.winH[i],
          // the texture holds it as a float, as the shader reads it
          style: f32(t.winStyle[i]),
          storey: t.storeyH[i],
          eave: t.eaveH[i],
          seed: t.rough[i],
        }
      : undefined;
  const sorted = cellNiches(tileNiches(mesh, objects, (i) => t.baseZ[i]));
  return {
    niches: packNiches(sorted.niches, t.baseZ),
    cells: sorted.cells,
    houses: houseBoxes(sorted.niches, t.root),
  };
}

/** Floats per house in `houseBoxes`: its root, then its windows' extent
 *  (x min, x max, z min, z max). */
export const HOUSE_STRIDE = 5;

/** Each house's windows' extent (`HOUSE_STRIDE`), from a `tileNiches`
 *  list: a house turns to niches as a whole (window-niche-layer.ts), and
 *  one may reach past the cells searched around the eye. */
export function houseBoxes(
  niches: Float32Array,
  root: Uint32Array
): Float32Array {
  const boxes = new Map<number, [number, number, number, number]>();
  for (let o = 0; o + NICHE_STRIDE <= niches.length; o += NICHE_STRIDE) {
    const key = root[niches[o + 8]] ?? niches[o + 8];
    const x = niches[o];
    const z = niches[o + 2];
    const box = boxes.get(key);
    if (box) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.max(box[1], x);
      box[2] = Math.min(box[2], z);
      box[3] = Math.max(box[3], z);
    } else {
      boxes.set(key, [x, x, z, z]);
    }
  }
  const out = new Float32Array(boxes.size * HOUSE_STRIDE);
  let o = 0;
  for (const [key, box] of boxes) {
    out.set([key, ...box], o);
    o += HOUSE_STRIDE;
  }
  return out;
}
