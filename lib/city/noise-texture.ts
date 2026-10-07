/**
 * The bytes of a value-noise texture that answers a 3D noise with one
 * bilinear tap (Íñigo Quílez's trick): R is white noise on a `size`²
 * lattice, G is R read `NOISE_SLICE` texels on, so a lattice point's next
 * z slice sits at the same uv in G. The crowns read it in place of
 * `mx_noise_float` (app/_components/crown-noise.ts), whose cost per
 * fragment and vertex took the crowns' frame time to ~1.6× main's.
 * Interleaved RG, x fastest; wraps at every edge.
 */

/** Where the next z slice lies in the lattice (texels). */
export const NOISE_SLICE: readonly [number, number] = [37, 17];

/** A small deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noiseTextureBytes(size: number, seed = 1): Uint8Array {
  const next = random(seed);
  const r = new Uint8Array(size * size);
  for (let i = 0; i < r.length; i++) {
    r[i] = Math.floor(next() * 256);
  }
  const out = new Uint8Array(size * size * 2);
  const [ox, oy] = NOISE_SLICE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      out[i * 2] = r[i];
      out[i * 2 + 1] = r[((y + oy) % size) * size + ((x + ox) % size)];
    }
  }
  return out;
}

/**
 * The noise the texture answers, on the CPU (for tests): −1…1 at `p`,
 * smoothstepped between lattice points, as crownNoise reads it.
 */
export function sampleNoise(
  bytes: Uint8Array,
  size: number,
  x: number,
  y: number,
  z: number
): number {
  const s = (t: number): number => t * t * (3 - 2 * t);
  const iz = Math.floor(z);
  const fz = s(z - iz);
  const u = x + NOISE_SLICE[0] * iz;
  const v = y + NOISE_SLICE[1] * iz;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = s(u - iu);
  const fv = s(v - iv);
  const at = (a: number, b: number, c: 0 | 1): number => {
    const xx = ((a % size) + size) % size;
    const yy = ((b % size) + size) % size;
    return bytes[(yy * size + xx) * 2 + c] / 255;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const plane = (c: 0 | 1): number =>
    lerp(
      lerp(at(iu, iv, c), at(iu + 1, iv, c), fu),
      lerp(at(iu, iv + 1, c), at(iu + 1, iv + 1, c), fu),
      fv
    );
  return lerp(plane(0), plane(1), fz) * 2 - 1;
}
