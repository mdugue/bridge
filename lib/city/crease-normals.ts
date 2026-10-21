/**
 * Vertex normals for the building mesh that round off a curve the LoD2
 * model drew as facets and keep its corners crisp. A rounded apse, a
 * curved front or a tower's drum is a ring of flat walls a few metres
 * wide, each turned 5–20° from the next; shaded flat, every facet takes
 * its own share of the sun and the curve reads as light and dark stripes.
 * Here each corner of a triangle takes the mean of the faces meeting at
 * its point that turn less than `CREASE_DEG` from its own — weighted by
 * the angle each face spans there, so how a facet was triangulated does
 * not tilt it. Faces turned further (a house's corner, an octagon's,
 * the eave between wall and roof) stay apart: their edge stays sharp.
 *
 * Two more rules keep it to curves. A facet is a few metres wide: a
 * triangle wider than `FACET_M` across is a plain wall or roof plane and
 * keeps its edges, so a long street front with a slight kink, or the
 * flat nave beside an apse, never shades as if bowed. And two faces
 * leaning towards different sides (more than `AZIMUTH_DEG` apart in plan)
 * meet at a ridge, hip or valley, however low the roof: a 12° gable's
 * ridge turns only 24°, a dome's facets lean the same way.
 *
 * Only faces of one group meet (`groups`: the bake gives one per object
 * and wall-or-roof), so two buildings standing back to back, or a wall
 * and its roof, never blend. Pure, no DOM.
 */

/** The largest turn between two faces still read as one curved surface
 *  (degrees). The facets of a rounded wall turn 5–20°; an octagon's
 *  corners turn 45° and a house's 90°. */
export const CREASE_DEG = 30;

/** The widest a triangle may be across (m, in plan) and still be a facet
 *  of a curve: the Kathedrale's are 2.5–4 m, a dome's under 5 m. */
export const FACET_M = 8;

/** Faces leaning to sides further apart than this in plan (degrees) meet
 *  at a ridge, hip or valley; a dome's or a drum's facets turn 20° at most. */
export const AZIMUTH_DEG = 60;

/** Below this lean (the sine of its slope) a face has no side it leans to. */
const LEVEL = Math.sin((5 * Math.PI) / 180);

/**
 * The normals of a non-indexed triangle stream (three vertices a
 * triangle), smoothed within `creaseDeg` per group; a triangle `skip`
 * marks keeps its flat normal and gives nothing to its neighbours (it is
 * shaded otherwise). A degenerate triangle keeps a zero normal.
 */
export function creaseNormals(
  positions: Float32Array,
  groups: ArrayLike<number>,
  options: { creaseDeg?: number; skip?: (triangle: number) => boolean } = {}
): Float32Array {
  const n = positions.length / 3;
  const faces = faceNormals(positions);
  const out = new Float32Array(positions.length);
  for (let v = 0; v < n; v++) {
    const t = Math.floor(v / 3);
    out.set(faces.normal.subarray(3 * t, 3 * t + 3), 3 * v);
  }
  const cos = Math.cos(((options.creaseDeg ?? CREASE_DEG) * Math.PI) / 180);
  const skip = options.skip ?? (() => false);
  const live = (v: number) => {
    const t = Math.floor(v / 3);
    return faces.area[t] > 0 && !skip(t);
  };
  const meets = facetsMeet(faces, cos);
  forEachPoint(positions, groups, live, (corners) => {
    if (corners.length > 1) {
      smoothPoint(corners, faces, meets, out);
    }
  });
  return out;
}

interface Faces {
  /** per vertex, the angle its triangle spans there (radians) */
  angle: Float32Array;
  /** per triangle, twice its area (0: degenerate) */
  area: Float32Array;
  /** per triangle, its unit normal (0 where degenerate) */
  normal: Float32Array;
  /** per triangle, its widest extent in plan (m) */
  width: Float32Array;
}

/** Whether triangles `t` and `u` are facets of one curve: turned less than
 *  the crease, both narrow, leaning to about the same side. */
function facetsMeet(faces: Faces, cos: number) {
  const n = faces.normal;
  const az = Math.cos((AZIMUTH_DEG * Math.PI) / 180);
  return (t: number, u: number): boolean => {
    if (t === u) {
      return true;
    }
    const d =
      n[3 * t] * n[3 * u] +
      n[3 * t + 1] * n[3 * u + 1] +
      n[3 * t + 2] * n[3 * u + 2];
    if (d < cos || faces.width[t] > FACET_M || faces.width[u] > FACET_M) {
      return false;
    }
    const ht = Math.hypot(n[3 * t], n[3 * t + 1]);
    const hu = Math.hypot(n[3 * u], n[3 * u + 1]);
    if (ht < LEVEL || hu < LEVEL) {
      return true;
    }
    return (
      (n[3 * t] * n[3 * u] + n[3 * t + 1] * n[3 * u + 1]) / (ht * hu) >= az
    );
  };
}

function faceNormals(p: Float32Array): Faces {
  const count = p.length / 9;
  const normal = new Float32Array(3 * count);
  const area = new Float32Array(count);
  const angle = new Float32Array(3 * count);
  const width = new Float32Array(count);
  for (let t = 0; t < count; t++) {
    const o = 9 * t;
    width[t] = Math.max(
      Math.hypot(p[o + 3] - p[o], p[o + 4] - p[o + 1]),
      Math.hypot(p[o + 6] - p[o + 3], p[o + 7] - p[o + 4]),
      Math.hypot(p[o] - p[o + 6], p[o + 1] - p[o + 7])
    );
    const ux = p[o + 3] - p[o];
    const uy = p[o + 4] - p[o + 1];
    const uz = p[o + 5] - p[o + 2];
    const wx = p[o + 6] - p[o];
    const wy = p[o + 7] - p[o + 1];
    const wz = p[o + 8] - p[o + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) {
      continue;
    }
    area[t] = len;
    normal[3 * t] = nx / len;
    normal[3 * t + 1] = ny / len;
    normal[3 * t + 2] = nz / len;
    for (let k = 0; k < 3; k++) {
      angle[3 * t + k] = cornerAngle(
        p,
        3 * t + k,
        3 * t + ((k + 1) % 3),
        3 * t + ((k + 2) % 3)
      );
    }
  }
  return { angle, area, normal, width };
}

function cornerAngle(p: Float32Array, at: number, b: number, c: number) {
  const ax = p[3 * b] - p[3 * at];
  const ay = p[3 * b + 1] - p[3 * at + 1];
  const az = p[3 * b + 2] - p[3 * at + 2];
  const cx = p[3 * c] - p[3 * at];
  const cy = p[3 * c + 1] - p[3 * at + 1];
  const cz = p[3 * c + 2] - p[3 * at + 2];
  const la = Math.hypot(ax, ay, az);
  const lc = Math.hypot(cx, cy, cz);
  if (la === 0 || lc === 0) {
    return 0;
  }
  const d = (ax * cx + ay * cy + az * cz) / (la * lc);
  return Math.acos(Math.min(1, Math.max(-1, d)));
}

/** Each point's corners: the vertices of `live` triangles at exactly the
 *  same position in the same group, bucketed by a hash of their bits. */
function forEachPoint(
  positions: Float32Array,
  groups: ArrayLike<number>,
  live: (v: number) => boolean,
  visit: (corners: number[]) => void
): void {
  const n = positions.length / 3;
  const bits = new Uint32Array(
    positions.buffer,
    positions.byteOffset,
    positions.length
  );
  // −0 and +0 are one coordinate
  const key = (i: number) => (bits[i] === 0x80000000 ? 0 : bits[i]);
  let size = 1;
  while (size < 2 * n) {
    size *= 2;
  }
  const hash = new Uint32Array(n);
  const start = new Uint32Array(size + 1);
  for (let v = 0; v < n; v++) {
    let h = Math.imul(key(3 * v) ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ key(3 * v + 1) ^ (h >>> 15), 0xc2b2ae35);
    h = Math.imul(h ^ key(3 * v + 2) ^ (h >>> 13), 0x27d4eb2f);
    h = Math.imul(h ^ (groups[v] | 0) ^ (h >>> 16), 0x165667b1);
    hash[v] = (h ^ (h >>> 15)) & (size - 1);
    start[hash[v] + 1]++;
  }
  for (let b = 0; b < size; b++) {
    start[b + 1] += start[b];
  }
  const fill = start.slice(0, size);
  const order = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    order[fill[hash[v]]++] = v;
  }
  const same = (a: number, b: number) =>
    key(3 * a) === key(3 * b) &&
    key(3 * a + 1) === key(3 * b + 1) &&
    key(3 * a + 2) === key(3 * b + 2) &&
    groups[a] === groups[b];
  for (let b = 0; b < size; b++) {
    const from = start[b];
    const to = start[b + 1];
    if (to - from < 2) {
      continue;
    }
    // a bucket may hold more than one point (a collision): split it
    const left = Array.from(order.subarray(from, to)).filter(live);
    while (left.length > 0) {
      const first = left[0];
      const corners = left.filter((v) => same(v, first));
      visit(corners);
      const rest = left.filter((v) => !same(v, first));
      left.length = 0;
      left.push(...rest);
    }
  }
}

/** Every corner at one point takes the angle-weighted mean of the faces
 *  there that `meets` its own. */
function smoothPoint(
  corners: readonly number[],
  faces: Faces,
  meets: (t: number, u: number) => boolean,
  out: Float32Array
): void {
  const fn = faces.normal;
  for (const v of corners) {
    const t = Math.floor(v / 3);
    let x = 0;
    let y = 0;
    let z = 0;
    for (const w of corners) {
      const u = Math.floor(w / 3);
      if (meets(t, u)) {
        const a = faces.angle[w];
        x += a * fn[3 * u];
        y += a * fn[3 * u + 1];
        z += a * fn[3 * u + 2];
      }
    }
    const len = Math.hypot(x, y, z);
    if (len > 1e-9) {
      out[3 * v] = x / len;
      out[3 * v + 1] = y / len;
      out[3 * v + 2] = z / len;
    }
  }
}
