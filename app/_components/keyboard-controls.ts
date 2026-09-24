/**
 * The keyboard adapter: turns key events into camera-pose calls and the
 * three one-shot actions. The event targets are injected so the adapter
 * runs against a fake document in unit tests.
 */

export interface KeyboardActions {
  /** R — demolish the building under the crosshair */
  demolish: () => void;
  press: (code: string) => void;
  release: (code: string) => void;
  /** every held key is dropped: the window lost focus or was hidden */
  releaseAll: () => void;
  /** F — walk <-> fly */
  toggleMode: () => void;
}

export interface KeyboardTargets {
  document: Pick<
    Document,
    "addEventListener" | "hidden" | "removeEventListener"
  >;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

const ONE_SHOTS = new Map<string, "demolish" | "toggleMode">([
  ["KeyR", "demolish"],
  ["KeyF", "toggleMode"],
]);

/** True for a key event aimed at a text field — the HUD owns those keys. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as {
    isContentEditable?: boolean;
    matches?: (selector: string) => boolean;
  } | null;
  return (
    el?.isContentEditable === true ||
    el?.matches?.("input, textarea, select") === true
  );
}

export function attachKeyboardControls(
  { document, window }: KeyboardTargets,
  actions: KeyboardActions
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // Held keys auto-repeat. Movement doesn't care (the key set is
    // idempotent), but the one-shot actions must fire once per press —
    // holding R used to re-parse the whole tile on every repeat.
    if (e.repeat || isTextEntry(e.target)) {
      return;
    }
    actions.press(e.code);
    const shot = ONE_SHOTS.get(e.code);
    if (shot) {
      actions[shot]();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    // Always release: the press may have landed on the canvas while the
    // release lands in a text field the user clicked into meanwhile.
    // Releasing a key that was never pressed is a no-op.
    actions.release(e.code);
  };
  // A keyup delivered to another window (Alt-Tab, a native dialog) would
  // leave the key held forever and the camera walking on its own.
  const onBlur = () => actions.releaseAll();
  const onVisibility = () => {
    if (document.hidden) {
      actions.releaseAll();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
  };
}
