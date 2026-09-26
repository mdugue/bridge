import { isRenderStyle, type RenderStyle } from "@/lib/city/render-style";

/**
 * The picture style (Bildstil) is remembered per viewer, like the folded
 * toolbar: whoever picked Papier comes back to Papier. Only the style — the
 * sliders stay a session's tuning, and a snapshot still carries its own
 * style. Storage can be missing or throw (private mode, blocked site data);
 * then the style simply is not remembered.
 */
const STYLE_KEY = "bildstil";

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
