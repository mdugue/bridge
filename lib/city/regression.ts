/**
 * Motion-keyed quality regression: a debounce that says "the camera is
 * moving, render cheaply". No THREE, no DOM.
 *
 * While the camera translates or turns, the depth-of-field bokeh produces
 * detail the eye cannot resolve anyway — motion has already destroyed it
 * (the contact shadows are never gated: skipping them blinked on every
 * footstep). Regress on the first
 * moving frame (a late regress is a visible hitch) and recover only after the
 * camera has been still for RECOVER_MS, so a single still frame in the middle
 * of a walk does not flicker the passes back on.
 */

import { lensFadeIn } from "./lens";

/** Stillness required (ms) before full quality comes back. */
export const RECOVER_MS = 250;

export interface RegressionState {
  regressed: boolean;
  stillMs: number;
}

export function createRegressionState(): RegressionState {
  return { regressed: false, stillMs: 0 };
}

/**
 * Advances the state by one frame. `moved` = the camera changed pose this
 * frame. Returns true when the caller should render at reduced quality.
 */
export function stepRegression(
  state: RegressionState,
  moved: boolean,
  dtMs: number
): boolean {
  if (moved) {
    state.regressed = true;
    state.stillMs = 0;
    return true;
  }
  state.stillMs += Math.max(dtMs, 0);
  if (state.stillMs >= RECOVER_MS) {
    state.regressed = false;
  }
  return state.regressed;
}

/**
 * How much of the depth of field shows this frame (0…1): none while
 * regressed, then growing in over `LENS_FADE_MS` (lens.ts) from the
 * moment of recovery, so the blur racks in instead of snapping on.
 */
export function lensFade(state: RegressionState): number {
  return state.regressed ? 0 : lensFadeIn(state.stillMs - RECOVER_MS);
}
