/**
 * The outline around the asked element, in numbers (plan 052; the pass is
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

/** The light halo just outside it, so it reads on dark asphalt too. */
export const OUTLINE_HALO = { from: 0.012, to: 0.07, strength: 0.55 };

/**
 * The selection's colours: the HUD's accent, so the outline, the mark on
 * the asked building and the card are one thing — the one place the
 * scene leaves its palette, since a choice is the interface's, not the
 * city's. Linear sRGB of app/globals.css: `line` is `--sidebar-primary`,
 * `ink` (the hatch) `--primary`, `halo` `--primary-foreground`.
 */
export const SELECTION_ACCENT = {
  line: [0.576, 0, 0.732],
  ink: [0.391, 0, 0.474],
  halo: [0.98, 0.905, 0.998],
} as const;

/**
 * The flash when something is newly asked: the halo widens outward and
 * glows in the accent, then settles into the steady halo over `ms`.
 * `from` is the halo's outer edge at the flash (a lower mask value lies
 * farther out), `glow` the accent's share of the halo then.
 */
export const OUTLINE_PULSE = { ms: 650, from: 0.002, glow: 0.75 };

/** The flash's strength `elapsed` ms after the question: 1 at once,
 *  easing out to 0 at OUTLINE_PULSE.ms (cubic). */
export function outlinePulse(elapsed: number): number {
  if (!(elapsed >= 0) || elapsed >= OUTLINE_PULSE.ms) {
    return 0;
  }
  const t = 1 - elapsed / OUTLINE_PULSE.ms;
  return t * t * t;
}

/**
 * Where something in front hides the element, the line is drawn on top
 * all the same, at this share of its ink: the hidden edge of a drawing,
 * lighter than the seen one, so the whole shape reads and so does what
 * stands before it.
 */
export const OUTLINE_HIDDEN = { strength: 0.42 };

/** The standard normal distribution's quantile (Acklam's approximation,
 *  ample for line widths). */
export function normalQuantile(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const tail = (q: number) =>
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) {
    return tail(Math.sqrt(-2 * Math.log(p)));
  }
  if (p > 1 - 0.02425) {
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
 * The blur's direction factor for a device pixel ratio: its taps step
 * `factor` half-resolution texels (two drawing pixels each), and its
 * kernel's sigma is (3 + 2·sigma) / 3 taps (`outlineKernel`).
 */
export function outlineSpread(pixelRatio: number): number {
  const kernelSigmaTaps = (3 + 2 * OUTLINE_BAND.sigma) / 3;
  return (outlineSigmaCssPx() * pixelRatio) / (2 * kernelSigmaTaps);
}

/**
 * The blur's weights, centre first, one side (the other mirrors it):
 * three's GaussianBlurNode kernel, which the outline drew with before it
 * blurred on one-byte targets of its own — 3 + 2·sigma taps a side of a
 * Gaussian whose sigma is a third of that, normalised over both sides.
 */
export function outlineKernel(sigma = OUTLINE_BAND.sigma): number[] {
  const taps = 3 + 2 * sigma;
  const s = taps / 3;
  const raw = Array.from({ length: taps }, (_, i) =>
    Math.exp((-0.5 * i * i) / (s * s))
  );
  const total = raw.reduce((sum, w, i) => sum + (i === 0 ? w : 2 * w), 0);
  return raw.map((w) => w / total);
}

/**
 * How long the outline's mask and first blur target outlive the last
 * question (ms): asking the next thing soon after reuses them, and a
 * viewer who stopped asking does not hold them (selection-outline.ts).
 */
export const OUTLINE_KEEP_MS = 10_000;
