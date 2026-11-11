/**
 * Outlines as a picture: a grey raster of how much of each pixel a set of
 * footprints covers (0 none … 255 whole), north up. The minimap's picture
 * of a city is a few hundred pixels across (Dresden ≈ 12 m a pixel), so
 * the build draws the buildings and the bridge decks into it this way
 * (scripts/bake-minimap.ts) instead of the viewer tracing every
 * footprint's points; the points stay in the packed files
 * (footprint-pack.ts) for what needs a building's exact outline (a
 * demolished one taken off the map, a design's cover).
 */
import type { FootprintPack } from "./footprint-pack";

/** Rows and columns sampled per pixel: 4 × 4, sixteen levels of cover. */
const SUB = 4;

/** The sub-pixel grid a cover raster is sampled on. */
interface Fine {
  cells: Uint8Array;
  cols: number;
  kx: number;
  ky: number;
  maxY: number;
  minX: number;
  rows: number;
}

/** Marks the sub-pixels `pack`'s objects cover: each object by the
 *  even-odd rule (its courtyards stay open), objects as a union. */
function fill(fine: Fine, pack: FootprintPack): void {
  const { cells, cols, kx, ky, maxY, minX, rows } = fine;
  const crossings: number[] = [];
  let ring = 0;
  for (const lastRing of pack.objectEnd) {
    const firstRing = ring;
    ring = lastRing;
    // the object's rows (sub-pixel), from its points' extent
    const p0 = firstRing === 0 ? 0 : pack.ringEnd[firstRing - 1];
    const p1 = lastRing === 0 ? 0 : pack.ringEnd[lastRing - 1];
    if (p1 - p0 < 3) {
      continue;
    }
    let top = Infinity;
    let bottom = -Infinity;
    for (let p = p0; p < p1; p += 1) {
      const row = (maxY - pack.xy[2 * p + 1] / 100) * ky;
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
    const r0 = Math.max(0, Math.ceil(top - 0.5));
    const r1 = Math.min(rows - 1, Math.floor(bottom - 0.5));
    for (let r = r0; r <= r1; r += 1) {
      // sampled at the sub-row's centre
      const y = r + 0.5;
      crossings.length = 0;
      for (let k = firstRing; k < lastRing; k += 1) {
        const a0 = k === 0 ? 0 : pack.ringEnd[k - 1];
        const a1 = pack.ringEnd[k];
        for (let i = a0, j = a1 - 1; i < a1; j = i, i += 1) {
          const yi = (maxY - pack.xy[2 * i + 1] / 100) * ky;
          const yj = (maxY - pack.xy[2 * j + 1] / 100) * ky;
          if (yi > y !== yj > y) {
            const xi = (pack.xy[2 * i] / 100 - minX) * kx;
            const xj = (pack.xy[2 * j] / 100 - minX) * kx;
            crossings.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
          }
        }
      }
      crossings.sort((a, b) => a - b);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const c0 = Math.max(0, Math.ceil(crossings[c] - 0.5));
        const c1 = Math.min(cols - 1, Math.floor(crossings[c + 1] - 0.5));
        cells.fill(1, r * cols + c0, r * cols + c1 + 1);
      }
    }
  }
}

/**
 * The cover raster of `packs` over `extent` [minX, minY, maxX, maxY] (EPSG
 * metres), `width` × `height` pixels, row 0 the northern edge.
 */
export function coverRaster(
  packs: readonly FootprintPack[],
  extent: readonly [number, number, number, number],
  width: number,
  height: number
): Uint8Array {
  const [minX, minY, maxX, maxY] = extent;
  const cols = width * SUB;
  const rows = height * SUB;
  const fine: Fine = {
    cells: new Uint8Array(cols * rows),
    cols,
    kx: cols / (maxX - minX),
    ky: rows / (maxY - minY),
    maxY,
    minX,
    rows,
  };
  for (const pack of packs) {
    fill(fine, pack);
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        const row = (y * SUB + sy) * cols + x * SUB;
        for (let sx = 0; sx < SUB; sx += 1) {
          covered += fine.cells[row + sx];
        }
      }
      out[y * width + x] = Math.round((covered * 255) / (SUB * SUB));
    }
  }
  return out;
}
