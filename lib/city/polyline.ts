/**
 * Pure polyline resampling shared by the layers that drape lines over the
 * terrain (walls, the wall→terrain conflation, rails, tree rows). No THREE,
 * no DOM.
 */

export type Point2 = [number, number];

function checkSpacing(spacing: number): void {
  if (!(spacing > 0)) {
    throw new RangeError(`polyline spacing must be positive, got ${spacing}`);
  }
}

/**
 * Every vertex of the polyline plus intermediate points so no two consecutive
 * points are further apart than `spacing`. Keeps corners exact — a wall or a
 * track ribbon built between the points then passes through every surveyed
 * vertex instead of cutting the corner.
 */
export function subdividePolyline(coords: Point2[], spacing: number): Point2[] {
  checkSpacing(spacing);
  const out: Point2[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) {
      continue; // a repeated vertex would otherwise become a duplicate point
    }
    const steps = Math.ceil(len / spacing);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  const last = coords.at(-1);
  if (last) {
    out.push(last);
  }
  return out;
}

/**
 * Points every `spacing` metres along the polyline, measured from its start
 * and carried across vertices, so a row of trees keeps an even rhythm through
 * corners. The end vertex is not a sample.
 */
export function samplePolyline(coords: Point2[], spacing: number): Point2[] {
  checkSpacing(spacing);
  const out: Point2[] = [];
  // Distance from the current segment's start to the next sample to emit.
  let dist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      continue;
    }
    while (dist < len) {
      const t = dist / len;
      out.push([x0 + dx * t, y0 + dy * t]);
      dist += spacing;
    }
    dist -= len; // carry the remainder into the next segment
  }
  return out;
}
