/** SMAA's two lookup tables, worked out instead of shipped as pictures. */

/**
 * The tables SMAA's second pass reads (Jimenez et al., "SMAA: Enhanced
 * Subpixel Morphological Antialiasing", 2012; their `AreaTex.py` and
 * `SearchTex.py`, MIT), for the preset the viewer runs: SMAA 1x without
 * diagonals, so of the area picture only the orthogonal block for
 * subsample offset 0 — 80 × 80 of three's 160 × 560, which came base64 in
 * the scene's chunk (35 kB gzipped) and through the browser's image
 * decoder. smaa-tables.test.ts holds both to three's pictures, value for
 * value.
 */

/** The area table's side: five by five crossing-edge patterns (`e1`, `e2`
 *  in quarters, 2 unused), each 16 × 16 distances. */
export const SMAA_AREA_SIZE = 80;
/** Distances per pattern and axis, stored by their square root. */
const AREA_DISTANCES = 16;
export const SMAA_SEARCH_WIDTH = 66;
export const SMAA_SEARCH_HEIGHT = 33;

type Point = readonly [number, number];
type Areas = readonly [number, number];
const NONE: Areas = [0, 0];

/**
 * How much of the pixel column [x, x + 1] the line from `p1` to `p2`
 * covers, under the pixel's edge and over it: the share to blend with
 * the neighbour on either side.
 */
function coverage(p1: Point, p2: Point, x: number): Areas {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const x2 = x + 1;
  const y1 = p1[1] + (dy * (x - p1[0])) / dx;
  const y2 = p1[1] + (dy * (x2 - p1[0])) / dx;
  const inside = (x >= p1[0] && x < p2[0]) || (x2 > p1[0] && x2 <= p2[0]);
  if (!inside) {
    return NONE;
  }
  const trapezoid =
    Math.sign(y1) === Math.sign(y2) ||
    Math.abs(y1) < 1e-4 ||
    Math.abs(y2) < 1e-4;
  if (trapezoid) {
    const a = (y1 + y2) / 2;
    return a < 0 ? [Math.abs(a), 0] : [0, Math.abs(a)];
  }
  // the line crosses the pixel's edge inside the column: two triangles
  const cross = (-p1[1] * dx) / dy + p1[0];
  const part = cross - Math.trunc(cross);
  const a1 = cross > p1[0] ? (y1 * part) / 2 : 0;
  const a2 = cross < p2[0] ? (y2 * (1 - part)) / 2 : 0;
  const a = Math.abs(a1) > Math.abs(a2) ? a1 : -a2;
  return a < 0 ? [Math.abs(a1), Math.abs(a2)] : [Math.abs(a2), Math.abs(a1)];
}

const sum = (a: Areas, b: Areas): Areas => [a[0] + b[0], a[1] + b[1]];

/**
 * The areas for one pattern of crossing edges at an edge's two ends (bit
 * 0: the left end's crossing edge goes up… as AreaTex.py numbers them),
 * `left` and `right` pixels from the ends.
 */
function orthogonalAreas(pattern: number, left: number, right: number): Areas {
  const d = left + right + 1;
  const half = d / 2;
  const up = 0.5;
  const down = -0.5;
  switch (pattern) {
    case 1: {
      return left <= right ? coverage([0, down], [half, 0], left) : NONE;
    }
    case 2: {
      return left >= right ? coverage([half, 0], [d, down], left) : NONE;
    }
    case 3: {
      return sum(
        coverage([0, down], [half, 0], left),
        coverage([half, 0], [d, down], left)
      );
    }
    case 4: {
      return left <= right ? coverage([0, up], [half, 0], left) : NONE;
    }
    case 6:
    case 7:
    case 14: {
      return coverage([0, up], [d, down], left);
    }
    case 8: {
      return left >= right ? coverage([half, 0], [d, up], left) : NONE;
    }
    case 9:
    case 11:
    case 13: {
      return coverage([0, down], [d, up], left);
    }
    case 12: {
      return sum(
        coverage([0, up], [half, 0], left),
        coverage([half, 0], [d, up], left)
      );
    }
    default: {
      return NONE;
    }
  }
}

/** Where each pattern's block lies in the table, in blocks. */
const PATTERN_BLOCKS: readonly Point[] = [
  [0, 0],
  [3, 0],
  [0, 3],
  [3, 3],
  [1, 0],
  [4, 0],
  [1, 3],
  [4, 3],
  [0, 1],
  [3, 1],
  [0, 4],
  [3, 4],
  [1, 1],
  [4, 1],
  [1, 4],
  [4, 4],
];

/**
 * The area table: `SMAA_AREA_SIZE`² texels of two bytes (the two blending
 * weights), row-major, the first row at v = 0.
 */
export function smaaAreaTable(): Uint8Array {
  const table = new Uint8Array(SMAA_AREA_SIZE * SMAA_AREA_SIZE * 2);
  for (const [pattern, [bx, by]] of PATTERN_BLOCKS.entries()) {
    for (let right = 0; right < AREA_DISTANCES; right += 1) {
      for (let left = 0; left < AREA_DISTANCES; left += 1) {
        const areas = orthogonalAreas(pattern, left * left, right * right);
        const at =
          2 *
          ((AREA_DISTANCES * by + right) * SMAA_AREA_SIZE +
            AREA_DISTANCES * bx +
            left);
        table[at] = Math.trunc(Math.min(areas[0], 1) * 255);
        table[at + 1] = Math.trunc(Math.min(areas[1], 1) * 255);
      }
    }
  }
  return table;
}

type Edges = readonly [number, number, number, number];

/** What a bilinear read between four edge texels returns, at the offsets
 *  the search samples with (a quarter and an eighth of a texel). */
const fetched = (e: Edges): number => {
  const a = e[0] + (e[1] - e[0]) * 0.75;
  const b = e[2] + (e[3] - e[2]) * 0.75;
  return a + (b - a) * 0.875;
};

/** How many pixels the last search step went too far, to the left… */
function deltaLeft(left: Edges, top: Edges): number {
  let d = top[3] === 1 ? 1 : 0;
  if (d === 1 && top[2] === 1 && left[1] !== 1 && left[3] !== 1) {
    d += 1;
  }
  return d;
}

/** …and to the right. */
function deltaRight(left: Edges, top: Edges): number {
  let d = top[3] === 1 && left[1] !== 1 && left[3] !== 1 ? 1 : 0;
  if (d === 1 && top[2] === 1 && left[0] !== 1 && left[2] !== 1) {
    d += 1;
  }
  return d;
}

/**
 * The search table: one byte a texel, `SMAA_SEARCH_WIDTH` ×
 * `SMAA_SEARCH_HEIGHT`, the left half for a search to the left and the
 * right half for one to the right; the value is the pixels to take back
 * (0, 1 or 2), read as value × 255.
 */
export function smaaSearchTable(): Uint8Array {
  const half = SMAA_SEARCH_WIDTH / 2;
  const edgesOf = new Map<number, Edges>();
  for (let bits = 0; bits < 16; bits += 1) {
    const e: Edges = [
      (bits >> 3) & 1,
      (bits >> 2) & 1,
      (bits >> 1) & 1,
      bits & 1,
    ];
    edgesOf.set(fetched(e), e);
  }
  const table = new Uint8Array(SMAA_SEARCH_WIDTH * SMAA_SEARCH_HEIGHT);
  for (let y = 0; y < SMAA_SEARCH_HEIGHT; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const left = edgesOf.get(x / 32);
      const top = edgesOf.get(y / 32);
      if (left && top) {
        table[y * SMAA_SEARCH_WIDTH + x] = deltaLeft(left, top);
        table[y * SMAA_SEARCH_WIDTH + x + half] = deltaRight(left, top);
      }
    }
  }
  return table;
}
