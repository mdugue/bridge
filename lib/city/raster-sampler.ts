/**
 * A CPU sampler over a single-band raster laid over a tile (row 0 = north),
 * reading the maximum over a 5×5 window around the point. No THREE, no DOM.
 */
import type { GreyRaster } from "./png-raster";
import type { TerrainBounds } from "./terrain-geometry";

/** Data-frame (x, y) → 0..1, or undefined off the raster. */
export type RasterSampler = (x: number, y: number) => number | undefined;

/**
 * Max byte over a 5×5 (~10 m) window = the crown footprint. The NDVI raster
 * is ~2 m/px and median-zero, so a single-pixel sample drops ~28% of trees
 * onto an empty pixel; the footprint max recovers the real canopy value (cuts
 * zeros to ~4% and roughly triples the median — measured).
 */
export function maxWindowSampler(
  raster: GreyRaster,
  bounds: TerrainBounds
): RasterSampler {
  const { data, width: w, height: h } = raster;
  const [minX, minY, maxX, maxY] = bounds;
  return (x, y) => {
    const u = (x - minX) / (maxX - minX);
    const v = (maxY - y) / (maxY - minY); // raster row 0 = north
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return;
    }
    const cx = Math.min(w - 1, Math.floor(u * w));
    const cy = Math.min(h - 1, Math.floor(v * h));
    let m = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const py = Math.min(h - 1, Math.max(0, cy + dy));
      for (let dx = -2; dx <= 2; dx++) {
        const px = Math.min(w - 1, Math.max(0, cx + dx));
        m = Math.max(m, data[py * w + px]);
      }
    }
    return m / 255;
  };
}
