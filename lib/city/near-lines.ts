/**
 * Whether a point lies within a reach of any of a set of polylines (the
 * tracks a lamp stands by): the segments hashed into square cells the
 * reach wide, so a query reads at most nine cells' segments. No THREE, no
 * DOM.
 */

/** A point as [x, y] (projected CRS, m). */
export type Point2 = readonly [number, number];

/** Distance² from (px, py) to the segment a–b. */
function segmentDistanceSq(
  px: number,
  py: number,
  a: Point2,
  b: Point2
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t =
    len > 0
      ? Math.min(Math.max(((px - a[0]) * dx + (py - a[1]) * dy) / len, 0), 1)
      : 0;
  const ex = px - (a[0] + dx * t);
  const ey = py - (a[1] + dy * t);
  return ex * ex + ey * ey;
}

/** A cell's key in the hash. */
const key = (cx: number, cy: number) => `${cx},${cy}`;

/**
 * A test for points within `reach` m of `lines`. An empty set of lines
 * finds nothing.
 */
export function nearLines(
  lines: readonly (readonly Point2[])[],
  reach: number
): (x: number, y: number) => boolean {
  const cells = new Map<string, [Point2, Point2][]>();
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const x0 = Math.floor(Math.min(a[0], b[0]) / reach);
      const x1 = Math.floor(Math.max(a[0], b[0]) / reach);
      const y0 = Math.floor(Math.min(a[1], b[1]) / reach);
      const y1 = Math.floor(Math.max(a[1], b[1]) / reach);
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
          const k = key(cx, cy);
          const list = cells.get(k);
          if (list) {
            list.push([a, b]);
          } else {
            cells.set(k, [[a, b]]);
          }
        }
      }
    }
  }
  const r2 = reach * reach;
  return (x, y) => {
    const cx = Math.floor(x / reach);
    const cy = Math.floor(y / reach);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const [a, b] of cells.get(key(cx + dx, cy + dy)) ?? []) {
          if (segmentDistanceSq(x, y, a, b) <= r2) {
            return true;
          }
        }
      }
    }
    return false;
  };
}
