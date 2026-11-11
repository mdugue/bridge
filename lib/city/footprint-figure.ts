/**
 * A tile's buildings as the minimap shows them: a grey raster of how much
 * of each pixel the footprints cover (0 none … 255 whole), north up. The
 * minimap is a few hundred pixels for a whole city (Dresden ≈ 26 m a
 * pixel), so it draws this picture instead of every footprint's points;
 * the points stay in the packed file (footprint-pack.ts) for what needs a
 * building's exact outline (a demolished one cut out, a design's cover).
 */
import type { FootprintPack } from "./footprint-pack";

/** The raster's edge (px) for a tile: 10.4 m a pixel on a 2 km tile. The
 *  sidebar's map shows Dresden's 10 km in some 600 device pixels (17 m a
 *  pixel); a site of two tiles is drawn about 1.5 times this. */
export const FIGURE_PX = 192;
/** Rows and columns sampled per pixel: 4 × 4, sixteen levels of cover. */
const SUB = 4;

/**
 * The cover raster of `pack` over `extent` [minX, minY, maxX, maxY] (EPSG
 * metres), `px` square, row 0 the northern edge. Each object fills by the
 * even-odd rule (its courtyards stay open); objects add as a union.
 */
export function figureRaster(
  pack: FootprintPack,
  extent: readonly [number, number, number, number],
  px = FIGURE_PX
): Uint8Array {
  const n = px * SUB;
  const [minX, minY, maxX, maxY] = extent;
  const kx = n / (maxX - minX);
  const ky = n / (maxY - minY);
  const fine = new Uint8Array(n * n);
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
    const r1 = Math.min(n - 1, Math.floor(bottom - 0.5));
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
        const c1 = Math.min(n - 1, Math.floor(crossings[c + 1] - 0.5));
        fine.fill(1, r * n + c0, r * n + c1 + 1);
      }
    }
  }
  const out = new Uint8Array(px * px);
  for (let y = 0; y < px; y += 1) {
    for (let x = 0; x < px; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        const row = (y * SUB + sy) * n + x * SUB;
        for (let sx = 0; sx < SUB; sx += 1) {
          covered += fine[row + sx];
        }
      }
      out[y * px + x] = Math.round((covered * 255) / (SUB * SUB));
    }
  }
  return out;
}
