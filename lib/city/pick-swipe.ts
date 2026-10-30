/**
 * Leafing through a selection's cards (pick-stack.tsx): which way a swipe
 * goes, and which pick each way brings to the front. Pure.
 */

/** How far a card is pulled before it counts as a swipe (px). */
export const SWIPE_PX = 80;
/** How fast a flick counts as a swipe however short (px/s) — past a
 *  twitch: a tap that drifts a few pixels is fast but goes nowhere. */
export const FLICK_PX_S = 500;
const FLICK_MIN_PX = 24;

/**
 * A drag's end as a step through the cards: +1 (to the left: the next), −1
 * (to the right: the one before), 0 (let go: the card springs back).
 */
export function swipeStep(offsetX: number, velocityX: number): -1 | 0 | 1 {
  const flick = Math.abs(offsetX) >= FLICK_MIN_PX;
  if (offsetX <= -SWIPE_PX || (flick && velocityX <= -FLICK_PX_S)) {
    return 1;
  }
  if (offsetX >= SWIPE_PX || (flick && velocityX >= FLICK_PX_S)) {
    return -1;
  }
  return 0;
}

/** The pick `step` cards on from `active`, round the deck. */
export function stepped(active: number, step: number, count: number): number {
  return count === 0 ? 0 : (((active + step) % count) + count) % count;
}

/** The cards behind the open one, the next first: a deck, not a list. */
export function deckBehind(active: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count - 1) }, (_, k) =>
    stepped(active, k + 1, count)
  );
}
