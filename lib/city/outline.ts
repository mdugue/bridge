/**
 * The outline around the asked element, in numbers (plan 049; the pass is
 * app/_components/selection-outline.ts). The silhouette's mask is blurred
 * with a Gaussian; across a straight edge the blurred value is the normal
 * distribution's CDF of the distance to the edge over the blur's sigma, so
 * a band between two values of it is a line of a known width. Widths are
 * CSS pixels: the blur's reach follows the device pixel ratio. No THREE.
 */

/** The graphite line's width on screen (CSS px). */
export const OUTLINE_WIDTH_CSS_PX = 4.5;

/**
 * The graphite band: where the blurred mask lies between `from` and `to`
 * (outside the silhouette a little more than inside: the line hugs the
 * element rather than eating into it); `sigma` is GaussianBlurNode's
 * kernel parameter (3 + 2·sigma taps).
 */
export const OUTLINE_BAND = { from: 0.07, to: 0.66, strength: 1, sigma: 4 };

/** The paper halo just outside it, so it reads on dark asphalt too. */
export const OUTLINE_HALO = { from: 0.012, to: 0.07, strength: 0.55 };

/** The standard normal distribution's quantile (Acklam's approximation,
 *  ample for line widths). */
export function normalQuantile(p: number): number {
  const a = [
    -3.969_683_028_665_376e1, 2.209_460_984_245_205e2, -2.759_285_104_469_687e2,
    1.383_577_518_672_69e2, -3.066_479_806_614_716e1, 2.506_628_277_459_239,
  ];
  const b = [
    -5.447_609_879_822_406e1, 1.615_858_368_580_409e2, -1.556_989_798_598_866e2,
    6.680_131_188_771_972e1, -1.328_068_155_288_572e1,
  ];
  const c = [
    -7.784_894_002_430_293e-3, -3.223_964_580_411_365e-1,
    -2.400_758_277_161_838, -2.549_732_539_343_734, 4.374_664_141_464_968,
    2.938_163_982_698_783,
  ];
  const d = [
    7.784_695_709_041_462e-3, 3.224_671_290_700_398e-1, 2.445_134_137_142_996,
    3.754_408_661_907_416,
  ];
  const tail = (q: number) =>
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.024_25) {
    return tail(Math.sqrt(-2 * Math.log(p)));
  }
  if (p > 1 - 0.024_25) {
    return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** The blur's sigma (CSS px) that makes the band OUTLINE_WIDTH_CSS_PX wide. */
export function outlineSigmaCssPx(): number {
  return (
    OUTLINE_WIDTH_CSS_PX /
    (normalQuantile(OUTLINE_BAND.to) - normalQuantile(OUTLINE_BAND.from))
  );
}

/**
 * GaussianBlurNode's direction factor for a device pixel ratio: its taps
 * step `factor` half-resolution texels (two drawing pixels each), and its
 * kernel's sigma is (3 + 2·sigma) / 3 taps.
 */
export function outlineSpread(pixelRatio: number): number {
  const kernelSigmaTaps = (3 + 2 * OUTLINE_BAND.sigma) / 3;
  return (outlineSigmaCssPx() * pixelRatio) / (2 * kernelSigmaTaps);
}
