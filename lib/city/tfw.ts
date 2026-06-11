/**
 * Parses an ESRI world file (.tfw) into a [minX, minY, maxX, maxY] bounding
 * box. Needed because geotiff.js cannot read .tfw sidecars — when a GeoTIFF
 * has no embedded geotransform, the georef only exists in this sidecar.
 *
 * World file lines: A (pixel width), D (row rotation), B (column rotation),
 * E (pixel height, negative for north-up), C (x of CENTER of top-left pixel),
 * F (y of CENTER of top-left pixel).
 */
const WHITESPACE = /\s+/;

export function tfwToBounds(
  tfwText: string,
  width: number,
  height: number
): [number, number, number, number] {
  const values = tfwText.trim().split(WHITESPACE).map(Number);
  if (values.length < 6 || values.some((v) => Number.isNaN(v))) {
    throw new Error(
      `Invalid .tfw content: expected 6 numbers, got "${tfwText.slice(0, 80)}"`
    );
  }
  const [a, d, b, e, c, f] = values;
  if (d !== 0 || b !== 0) {
    throw new Error(
      "Rotated rasters (.tfw with non-zero D/B terms) are not supported"
    );
  }
  if (a <= 0 || e >= 0) {
    throw new Error(
      `Expected north-up raster (A > 0, E < 0), got A=${a}, E=${e}`
    );
  }
  // C/F reference the pixel CENTER -> shift by half a pixel to the edge.
  const minX = c - a / 2;
  const maxY = f - e / 2;
  const maxX = minX + width * a;
  const minY = maxY + height * e;
  return [minX, minY, maxX, maxY];
}
