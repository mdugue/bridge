/**
 * Where a tile's water and river mist can show: a coarse grid of cells over
 * the tile, set where its class raster has water, widened by how far each
 * sheet's coverage reaches past the bank. The water and mist sheets drape
 * the terrain mesh and mask themselves to the water class per fragment;
 * draped over the whole tile, both shaded every ground pixel on screen
 * twice to throw ≥ 92 % of them away (Dresden's tiles are at most 8 %
 * water), and on a phone's GPU a blended sheet with `discard` is paid in
 * full. With the mask the sheets keep only the triangles near water — and
 * a tile without water has none. No THREE, no DOM.
 */

/** Cells per tile side (a 2 km tile: 7.8 m cells). */
export const WATER_CELLS = 256;

/**
 * How far (m) each sheet's coverage reaches past the water class. Both read
 * the painted splat's alpha (a 3×3 tent, a few metres) through its mip
 * chain, which a grazing view far off reads several levels down. The water
 * cuts its coverage at 0.28 (`smoothstep`), half a texel of a mip where a
 * river is a few texels wide: 100 m holds out to the fog. The mist reads a
 * mip five levels further down (`bias(5)`, water-layer.ts
 * `mistCoverage`) and keeps any coverage above 0.01: at 1–2 km, where it is
 * full, that is a mip of 256–512 m texels, whose bilinear blur spreads a
 * river's haze about one texel past its bank — cut nearer, the haze would
 * end at triangle edges.
 */
export const WATER_REACH_M = 100;
export const MIST_REACH_M = 600;

/** A tile's water cells, row 0 at its north edge (as the raster's rows). */
export interface WaterMask {
  cells: number;
  /** 1 where the cell has water */
  water: Uint8Array;
}

/**
 * The water cells of a class raster (`width` × `height` ids, row 0 north),
 * or null where it has none. Every texel is read: a ditch one texel wide is
 * water the splat paints, and a stride would step over it.
 */
export function waterMaskOf(
  data: ArrayLike<number>,
  width: number,
  height: number,
  waterClass: number,
  cells = WATER_CELLS
): WaterMask | null {
  const water = new Uint8Array(cells * cells);
  // each column's cell, once
  const column = new Uint16Array(width);
  for (let x = 0; x < width; x++) {
    column[x] = Math.min(cells - 1, Math.floor((x * cells) / width));
  }
  let any = false;
  for (let y = 0; y < height; y++) {
    const row = Math.min(cells - 1, Math.floor((y * cells) / height)) * cells;
    const at = y * width;
    for (let x = 0; x < width; x++) {
      if (data[at + x] === waterClass) {
        water[row + column[x]] = 1;
        any = true;
      }
    }
  }
  return any ? { cells, water } : null;
}

/** The mask widened by `r` cells every way (a square reach). */
export function dilate(mask: WaterMask, r: number): WaterMask {
  const { cells } = mask;
  const run = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    for (let a = 0; a < cells; a++) {
      // the last set cell seen along the line, for a running reach
      let last = Number.NEGATIVE_INFINITY;
      // forward: set within r after a set cell
      for (let b = 0; b < cells; b++) {
        const i = horizontal ? a * cells + b : b * cells + a;
        if (src[i]) {
          last = b;
        }
        if (b - last <= r) {
          out[i] = 1;
        }
      }
      last = Number.POSITIVE_INFINITY;
      // backward: set within r before one
      for (let b = cells - 1; b >= 0; b--) {
        const i = horizontal ? a * cells + b : b * cells + a;
        if (src[i]) {
          last = b;
        }
        if (last - b <= r) {
          out[i] = 1;
        }
      }
    }
    return out;
  };
  return { cells, water: run(run(mask.water, true), false) };
}

/** The mask widened by `metres` on a tile `tileM` wide. */
export function reach(
  mask: WaterMask,
  metres: number,
  tileM: number
): WaterMask {
  return dilate(mask, Math.ceil((metres * mask.cells) / tileM));
}

/**
 * The triangles of `index` that touch a set cell, as an index of their
 * own, as wide as the index: each triangle's box in cells (`cellX`, `cellY` per vertex) tested
 * against the mask's summed-area table, so a TIN's long river triangles are
 * kept whole and a grid's 4 m ones cost one lookup each.
 */
export function trianglesOver<T extends Uint8Array | Uint16Array | Uint32Array>(
  index: T,
  cellX: ArrayLike<number>,
  cellY: ArrayLike<number>,
  mask: WaterMask
): T {
  const { cells } = mask;
  const w = cells + 1;
  const sat = new Int32Array(w * w);
  for (let y = 0; y < cells; y++) {
    let row = 0;
    for (let x = 0; x < cells; x++) {
      row += mask.water[y * cells + x];
      sat[(y + 1) * w + x + 1] = sat[y * w + x + 1] + row;
    }
  }
  const clamp = (c: number) => Math.min(cells - 1, Math.max(0, c));
  // the index's own width: a 16-bit index stays 16-bit
  const kept = new (index.constructor as new (length: number) => T)(
    index.length
  );
  let n = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const x0 = clamp(Math.min(cellX[a], cellX[b], cellX[c]));
    const x1 = clamp(Math.max(cellX[a], cellX[b], cellX[c]));
    const y0 = clamp(Math.min(cellY[a], cellY[b], cellY[c]));
    const y1 = clamp(Math.max(cellY[a], cellY[b], cellY[c]));
    const sum =
      sat[(y1 + 1) * w + x1 + 1] -
      sat[y0 * w + x1 + 1] -
      sat[(y1 + 1) * w + x0] +
      sat[y0 * w + x0];
    if (sum > 0) {
      kept[n++] = a;
      kept[n++] = b;
      kept[n++] = c;
    }
  }
  return kept.slice(0, n) as T;
}
