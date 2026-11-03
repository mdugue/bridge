import type { LookState } from "@/lib/city/look-state";
import { isRenderStyle, type RenderStyle } from "@/lib/city/render-style";
import { STORAGE_KEYS } from "./storage-keys";

/**
 * The picture style (Bildstil) is remembered per viewer, like the folded
 * toolbar: whoever picked Papier comes back to Papier. Only the style — the
 * fog and the crowns' switch stay a session's tuning, and a snapshot still
 * carries its own style. Storage can be missing or throw (private mode, blocked site data);
 * then the style simply is not remembered.
 */
const STYLE_KEY = STORAGE_KEYS.style;

export function readStoredStyle(): RenderStyle | null {
  try {
    const value = localStorage.getItem(STYLE_KEY);
    return isRenderStyle(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredStyle(style: RenderStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {
    // Not remembered, nothing else lost.
  }
}

/**
 * Stores each new style of `look` unless `paused` (a walk's stops bring
 * styles that are not the visitor's); returns the unsubscribe.
 */
export function rememberStyle(
  look: Pick<LookState, "get" | "subscribe">,
  paused: () => boolean
): () => void {
  let remembered = look.get().style;
  return look.subscribe((values) => {
    if (!paused() && values.style !== remembered) {
      remembered = values.style;
      writeStoredStyle(values.style);
    }
  });
}
