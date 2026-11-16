/**
 * Two plates of one view compared (plan 087, phases 3 and 4): per pixel
 * the largest difference of a colour channel; a pixel differs above a
 * level, a view above a share of its pixels. It answers "did the picture
 * change", for a base and a head rendered by the same machine — never
 * whether a picture is good (ADR 0018). Pure: the pixels come decoded
 * (scripts/plates.ts reads the PNGs with sharp).
 *
 * The tolerances are per tier, each from its own renderer's noise floor:
 * ten pairs of plates of one build, and what moved between them.
 */

/** A decoded plate: rows of pixels, `channels` bytes each (RGB or RGBA). */
export interface Plate {
  channels: 3 | 4;
  data: Uint8Array;
  height: number;
  width: number;
}

/** The level and the share a tier compares with. */
export interface PlateTolerance {
  /** a pixel differs when a channel is further apart than this (of 255) */
  level: number;
  /** a view differs when more than this share of its pixels does */
  share: number;
}

/**
 * Tier 1: SwiftShader's Vulkan, 800 × 500 at 1×, the `lite` profile, the
 * scene held `still` (scripts/plates.ts). The level is the flicker-probe
 * skill's, 24 of 255. Measured in the cloud container on 2026-11-16 (plan
 * 087, Findings): in ten same-commit pairs of the tier's eight views no
 * pixel differed by even one step — a software renderer on a still scene
 * is a function of its input. So neither number is a floor; both are
 * margins. The level keeps out what a plate owes to the views rendered
 * before it (one view alone against the same view seventh in the row: up
 * to 19 of 255 in 276 pixels) and a rounding step of another CPU's
 * SwiftShader; the share, 20 of a plate's 400 000 pixels, keeps a flipped
 * edge pixel from being a changed view while a moved kerb still is.
 */
export const TIER1_TOLERANCE: PlateTolerance = { level: 24, share: 5e-5 };

/**
 * Tier 2, a real GPU: not measured yet (plan 087, "What is left for tier
 * 2"). Until its own ten pairs are in, it compares with tier 1's numbers,
 * and the report says so.
 */
export const TIER2_TOLERANCE: PlateTolerance = TIER1_TOLERANCE;

/** What two plates differ by. */
export interface PlateDiff {
  /** pixels over the level */
  differing: number;
  /** per pixel the largest channel difference (0–255), row-major */
  levels: Uint8Array;
  /** the largest difference of any channel of any pixel */
  max: number;
  pixels: number;
  /** `differing / pixels` */
  share: number;
}

/**
 * The difference of two plates of the same size. Alpha is not compared: a
 * canvas's plate is opaque. Plates of different size are an error, not a
 * difference — they were not rendered the same way.
 */
export function diffPlates(a: Plate, b: Plate, level: number): PlateDiff {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `plates of different size: ${a.width}×${a.height} against ${b.width}×${b.height}`
    );
  }
  const pixels = a.width * a.height;
  if (
    a.data.length !== pixels * a.channels ||
    b.data.length !== pixels * b.channels
  ) {
    throw new Error("a plate's data does not match its size");
  }
  const levels = new Uint8Array(pixels);
  let differing = 0;
  let max = 0;
  for (let p = 0; p < pixels; p += 1) {
    const i = p * a.channels;
    const j = p * b.channels;
    const d = Math.max(
      Math.abs(a.data[i] - b.data[j]),
      Math.abs(a.data[i + 1] - b.data[j + 1]),
      Math.abs(a.data[i + 2] - b.data[j + 2])
    );
    levels[p] = d;
    if (d > level) {
      differing += 1;
    }
    if (d > max) {
      max = d;
    }
  }
  return { differing, levels, max, pixels, share: differing / pixels };
}

/** Whether a view differs: more than the share of its pixels do. */
export function plateDiffers(diff: PlateDiff, share: number): boolean {
  return diff.share > share;
}

/**
 * The difference as a picture (RGB): the head in pale grey, each pixel
 * over the level in red — the flicker-probe skill's red map.
 */
export function diffImage(head: Plate, diff: PlateDiff, level: number): Plate {
  const data = new Uint8Array(diff.pixels * 3);
  for (let p = 0; p < diff.pixels; p += 1) {
    const i = p * head.channels;
    const grey =
      (head.data[i] * 2 + head.data[i + 1] * 5 + head.data[i + 2]) / 8;
    const pale = Math.round(160 + grey * 0.37);
    const over = diff.levels[p] > level;
    data[p * 3] = over ? 220 : pale;
    data[p * 3 + 1] = over ? 0 : pale;
    data[p * 3 + 2] = over ? 0 : pale;
  }
  return { channels: 3, data, height: head.height, width: head.width };
}
