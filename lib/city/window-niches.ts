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
 *  what the shader draws, see the head comment). */
export function wallOpenings(
  o: NicheObject,
  lengthCode: number,
  eaveCode: number,
  topH: number
): WallOpening[] {
  const { centres, w } = wallColumns(o, lengthCode);
  if (centres.length === 0) {
    return [];
  }
  const depth = revealDepth(o.style);
  const rows = wallRows(o, eaveCode, topH);
  return centres.flatMap((s, j) =>
    rows.map((r) => ({
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

/** A triangle's horizontal unit normal in the scene frame, or undefined
 *  when it is no wall (as upright as the clay's `wall` term wants). */
function uprightNormal(
  p: ArrayLike<number>,
  a: number,
  b: number,
  c: number
): [number, number] | undefined {
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
  const lh = Math.hypot(nx, nz);
  // the clay's wall: |n.y| under 0.5 (smoothstep 0.5–0.7)
  if (len < 1e-9 || Math.abs(ny) > 0.5 * len) {
    return undefined;
  }
  return [nx / lh, nz / lh];
}

/** Whether (s, y) lies in one of a wall's triangles (a hair inside). */
function onWall(tris: readonly number[], s: number, y: number): boolean {
  for (let i = 0; i < tris.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = tris.slice(i, i + 6);
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

/** Gathers a city mesh's window-carrying walls by object, codes and plane. */
function gatherWalls(
  mesh: NicheMesh,
  objects: (object: number) => NicheObject | undefined,
  base: (object: number) => number
): NicheWall[] {
  const p = mesh.positions;
  const f = mesh.facade;
  const walls = new Map<string, NicheWall>();
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
    const key = `${object}:${length}:${f[4 * a + 3]}:${Math.round(n[0] * 1000)}:${Math.round(n[1] * 1000)}`;
    let w = walls.get(key);
    const z0 = base(object);
    if (!w) {
      w = {
        object,
        length,
        eave: f[4 * a + 3],
        nx: n[0],
        nz: n[1],
        px: p[3 * a],
        pz: p[3 * a + 2],
        s0: snormOf(f[4 * a]) * FACADE_SCALE_M,
        tris: [],
        top: Number.NEGATIVE_INFINITY,
      };
      walls.set(key, w);
    }
    for (const v of [a, b, c]) {
      const h = p[3 * v + 1] - z0;
      w.tris.push(snormOf(f[4 * v]) * FACADE_SCALE_M, h);
      w.top = Math.max(w.top, h);
    }
  }
  return [...walls.values()];
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
  for (const w of gatherWalls(mesh, objects, base)) {
    const o = objects(w.object);
    if (!o) {
      continue;
    }
    // along the wall: t = (n.z, −n.x) in the scene's (x, z) — the data
    // frame's (n.y, −n.x) with z = −y
    const tx = -w.nz;
    const tz = w.nx;
    for (const op of wallOpenings(o, w.length, w.eave, w.top)) {
      const mid = (op.v0 + op.v1) / 2;
      // any of its middle and corners (a hair in) on the wall: a niche
      // too many stays unseen behind it, one too few is a hole
      const ins = Math.max(op.half - 0.05, 0);
      const inv = Math.max((op.v1 - op.v0) / 2 - 0.05, 0);
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
  eaveH: Float32Array;
  rough: Float32Array;
  storeyH: Float32Array;
  winAxis: Float32Array;
  winH: Float32Array;
  winStyle: Uint32Array;
  winW: Float32Array;
}

/** A tile's niches from its mesh and table, sorted by cell (`cellNiches`). */
export function nichesOf(
  mesh: NicheMesh,
  t: NicheTable
): { niches: Float32Array; cells: Float64Array } {
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
  return cellNiches(tileNiches(mesh, objects, (i) => t.baseZ[i]));
}
