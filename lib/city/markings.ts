/**
 * Road markings (pipeline/bake/markings.py, plan 026): zebra and signalled
 * crossings and stop lines as a table of rotated rectangles, cycle lanes
 * and centre lines as per-texel bits of an index raster. The terrain
 * shader paints them in its own fragment pass
 * (app/_components/road-markings.ts). No THREE, no DOM.
 */

/** The marking kinds (the bake's `KINDS`; the ids are the index). */
export const MARKING_KINDS = ["none", "zebra", "furt", "stop"] as const;
export type MarkingKind = (typeof MARKING_KINDS)[number];

export function markingKindId(kind: MarkingKind): number {
  return MARKING_KINDS.indexOf(kind);
}

/** The raster's lane bits (G). */
export const LANE_BITS = { cycle: 1, centre: 4 } as const;

/** Bytes per metre of the raster's centre offset (B), as the edge raster. */
export const MARKING_OFFSET_SCALE = 20;

/**
 * Pattern lengths along a street divide the paving raster's along-street
 * period (165 m, `SURFACE_ALONG_PERIOD`), so its wrap never shows: centre
 * dashes 3 m in 8.25 m, cycle-lane dashes half of 2.0625 m. Across a
 * crossing the pattern is the crossing's own.
 */
export const MARKING_PATTERN = {
  /** the cycle lane's broken line: its distance from the kerb (m) */
  cycleFromKerb: 1.85,
  cycleHalfWidth: 0.125,
  cyclePeriod: 2.0625,
  centreDash: 3,
  centreHalfWidth: 0.06,
  centrePeriod: 8.25,
  /** a furt's broken lines: 0.5 m dashes, 0.2 m gaps, 0.12 m wide */
  furtDash: 0.5,
  furtHalfWidth: 0.06,
  furtPeriod: 0.7,
  /** zebra bars: 0.5 m bars, 0.5 m gaps */
  zebraBar: 0.5,
  zebraPeriod: 1,
} as const;

/** One row: `[cx, cy, angle, halfLength, halfWidth, kind]` — the centre in
 *  metres from the tile's north-west corner (x east, y north), the axis
 *  across the road in radians from east, half the extent across and along
 *  the road. */
export type MarkingRow = [number, number, number, number, number, number];

/** `markings_<tile>.json` as the bake writes it (only what the viewer reads). */
export interface MarkingTable {
  markings: MarkingRow[];
}

/**
 * The table as the shader's data texture: row i is column i of a 2-texel-
 * high RGBA float texture — texel 0 (cx, cy, cos, sin), texel 1
 * (halfLength, halfWidth, kind, 0). Kinds the viewer does not know are kept
 * as `none`, so the raster's row numbers stay valid.
 */
export function packMarkingTable(table: MarkingTable): {
  data: Float32Array;
  width: number;
} {
  const rows = table.markings;
  const width = rows.length;
  const data = new Float32Array(width * 8);
  for (const [i, [cx, cy, angle, hl, hw, kind]] of rows.entries()) {
    data.set([cx, cy, Math.cos(angle), Math.sin(angle)], i * 4);
    const known = kind > 0 && kind < MARKING_KINDS.length ? kind : 0;
    data.set([hl, hw, known, 0], (width + i) * 4);
  }
  return { data, width };
}

/**
 * Coverage of stripes `[k·period, k·period + bar)` over the footprint
 * `[x − w, x + w]`, exactly (the shader's `rmStripes`): a pattern far off
 * averages to bar / period instead of shimmering.
 */
export function stripeCoverage(
  x: number,
  bar: number,
  period: number,
  w: number
): number {
  const cumulative = (t: number) =>
    Math.floor(t / period) * bar +
    Math.min(t - Math.floor(t / period) * period, bar);
  return (cumulative(x + w) - cumulative(x - w)) / (2 * w);
}
