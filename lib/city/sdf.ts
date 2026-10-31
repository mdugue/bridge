/**
 * A signed distance field from a glyph's coverage (the nameplate's
 * lettering, app/_components/nameplate-glyphs.ts): the exact Euclidean
 * distance transform of Felzenszwalb and Huttenlocher, run once for the
 * outside and once for the inside, with the antialiased edge's coverage
 * placing the edge between pixels. The field is 0.5 on the edge, rising
 * inside and falling outside by 0.5 per `radius` px — so a shader draws
 * the letter at 0.5, its halo or outline at any distance up to `radius`,
 * sharp at any size. No THREE, no DOM.
 */

const INF = 1e20;

/** One row or column of the squared distance transform, in place. */
function edt1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Uint16Array,
  z: Float64Array
): void {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

/** The 2-D squared distance transform of `grid` (0 at the seeds, INF
 *  elsewhere), in place. */
function edt(grid: Float64Array, width: number, height: number): void {
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const v = new Uint16Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < width; x++) {
    edt1d(grid, x, width, height, f, v, z);
  }
  for (let y = 0; y < height; y++) {
    edt1d(grid, y * width, 1, width, f, v, z);
  }
}

/**
 * The field (one byte a pixel) of a coverage map (0…255 a pixel, as a
 * canvas's alpha): 128 on the edge, 255 at `radius` px inside and beyond,
 * 0 at `radius` px outside and beyond.
 */
export function signedDistanceField(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const size = width * height;
  const outer = new Float64Array(size);
  const inner = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const a = alpha[i] / 255;
    if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      // an edge pixel: its coverage says how far the edge lies from its
      // centre (tiny-sdf's estimate)
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  edt(outer, width, height);
  edt(inner, width, height);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const signed = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    const value = 0.5 - signed / (2 * radius);
    out[i] = Math.round(Math.min(Math.max(value, 0), 1) * 255);
  }
  return out;
}
