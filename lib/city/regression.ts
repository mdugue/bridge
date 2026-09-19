/**
 * Motion-keyed quality regression: a debounce that says "the camera is
 * moving, render cheaply". No THREE, no DOM.
 *
 * While the camera translates or turns, the two most expensive post passes
 * (SSAO contact shadows, depth-of-field bokeh) produce detail the eye cannot
 * resolve anyway — motion has already destroyed it. Regress on the first
 * moving frame (a late regress is a visible hitch) and recover only after the
 * camera has been still for RECOVER_MS, so a single still frame in the middle
 * of a walk does not flicker the passes back on.
 */

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
  dtMs: number,
  recoverMs: number = RECOVER_MS
): boolean {
  if (moved) {
    state.regressed = true;
    state.stillMs = 0;
    return true;
  }
  state.stillMs += Math.max(dtMs, 0);
  if (state.stillMs >= recoverMs) {
    state.regressed = false;
  }
  return state.regressed;
}
