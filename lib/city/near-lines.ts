/**
 * Whether a point lies within a reach of any of a set of polylines (the
 * tracks a lamp stands by): the segments hashed into square cells the
 * reach wide (each segment in the cells it passes), so a query reads
 * the 5 × 5 cells round its own. No THREE, no
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
  const add = (cx: number, cy: number, seg: [Point2, Point2]) => {
    const k = key(cx, cy);
    const list = cells.get(k);
    if (!list) {
      cells.set(k, [seg]);
    } else if (list.at(-1) !== seg) {
      list.push(seg);
    }
  };
  // each segment in the cells it passes, sampled every half cell (a query
  // reads two cells round its own, so the corner a sample cuts is read)
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const seg: [Point2, Point2] = [line[i - 1], line[i]];
      const [a, b] = seg;
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (reach / 2))
      );
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        add(
          Math.floor((a[0] + (b[0] - a[0]) * t) / reach),
          Math.floor((a[1] + (b[1] - a[1]) * t) / reach),
          seg
        );
      }
    }
  }
  const r2 = reach * reach;
  return (x, y) => {
    const cx = Math.floor(x / reach);
    const cy = Math.floor(y / reach);
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
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
