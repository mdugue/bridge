/**
 * The exact weld of a triangle soup: vertices whose every attribute is bit
 * for bit the same become one, and an index says which each corner is — the
 * same picture from fewer vertices. A quad's two triangles share two
 * corners, a ribbon's quads their ends, a draped area's triangles nearly
 * all of theirs. Used by the fine terrain's glb (scripts/tile-glb.ts) and
 * by the runtime's line and bridge meshes (app/_components/mesh-kit.ts),
 * there in steps (build-steps.ts). No DOM, no three.
 */
import { finished } from "./build-steps";
import type { Steps } from "./build-steps";

/** A vertex attribute: its values and how many a vertex has. */
export type WeldColumn = readonly [
  Float32Array | Int8Array | Int16Array | Uint32Array,
  number,
];

export interface Welded {
  /** per corner of the soup, its vertex among the kept */
  indices: Uint32Array<ArrayBuffer>;
  /** per kept vertex, the soup vertex it was first seen as */
  kept: Uint32Array;
  /** how many are kept */
  unique: number;
}

/** Vertices hashed per step. */
const WELD_RUN = 1 << 12;

/** A column's values as integers that differ wherever its bits do. */
function bitsOf(a: WeldColumn[0]): ArrayLike<number> {
  return a instanceof Float32Array
    ? new Uint32Array(a.buffer, a.byteOffset, a.length)
    : a;
}

/**
 * `count` vertices welded over `columns`.
 * @yields {void} after each run of vertices, to hand the thread back
 */
export function* weldSteps(
  columns: readonly WeldColumn[],
  count: number
): Steps<Welded> {
  const bits = columns.map(([a, n]) => [bitsOf(a), n] as const);
  let size = 4;
  while (size < 2 * count) {
    size *= 2;
  }
  // open addressing: a slot holds a kept vertex's place among the kept + 1
  const slots = new Uint32Array(size);
  const kept = new Uint32Array(count);
  const indices = new Uint32Array(count);
  const same = (v: number, w: number): boolean => {
    for (const [a, n] of bits) {
      for (let c = 0; c < n; c += 1) {
        if (a[n * v + c] !== a[n * w + c]) {
          return false;
        }
      }
    }
    return true;
  };
  let unique = 0;
  for (let v = 0; v < count; v += 1) {
    let h = 0x9e_37_79_b9;
    for (const [a, n] of bits) {
      for (let c = 0; c < n; c += 1) {
        h = Math.imul(h ^ a[n * v + c] ^ (h >>> 15), 0x85_eb_ca_6b);
      }
    }
    let slot = (h ^ (h >>> 13)) & (size - 1);
    while (slots[slot] !== 0 && !same(kept[slots[slot] - 1], v)) {
      slot = (slot + 1) & (size - 1);
    }
    if (slots[slot] === 0) {
      kept[unique] = v;
      unique += 1;
      slots[slot] = unique;
    }
    indices[v] = slots[slot] - 1;
    if (v % WELD_RUN === WELD_RUN - 1) {
      yield;
    }
  }
  return { indices, kept: kept.subarray(0, unique), unique };
}

/** `weldSteps`, here and now. */
export function welded(columns: readonly WeldColumn[], count: number): Welded {
  return finished(weldSteps(columns, count));
}

/** A column (`n` values a vertex) with only the kept vertices in it. */
export function packed<T extends WeldColumn[0]>(a: T, n: number, w: Welded): T {
  const out = new (a.constructor as new (length: number) => T)(n * w.unique);
  for (let u = 0; u < w.unique; u += 1) {
    const from = n * w.kept[u];
    for (let c = 0; c < n; c += 1) {
      out[n * u + c] = a[from + c];
    }
  }
  return out;
}
