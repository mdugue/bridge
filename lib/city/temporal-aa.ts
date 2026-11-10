/**
 * The temporal antialiasing's numbers (app/_components/temporal-aa.ts
 * draws it): the sub-pixel offsets the camera is shifted by, frame after
 * frame, and how much of each new frame the history takes. No THREE, no
 * DOM.
 *
 * A window a pixel or two wide in a street seen along its length hops
 * from pixel to pixel as the eye moves, and its hard edges crawl: no
 * single frame can draw what lies between the pixels. Each frame is drawn
 * a fraction of a pixel off the last (a Halton sequence covers the pixel
 * evenly), taken back to where the last frame saw the same point (the
 * camera's motion, from depth) and averaged into the history there.
 */

/** Offsets in the cycle: eight cover a pixel evenly enough. */
export const JITTER_COUNT = 8;

/** The share of a new frame in the average: about the last ten frames. */
export const CURRENT_WEIGHT = 0.1;

/** The radical inverse of `index` in `base` (0…1): a Halton coordinate. */
export function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** The camera's shift for frame `frame` (pixels, each −0.5…0.5). */
export function jitterOffset(frame: number): [number, number] {
  const i = (frame % JITTER_COUNT) + 1;
  return [halton(i, 2) - 0.5, halton(i, 3) - 0.5];
}
