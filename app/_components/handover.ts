import type { LoadStageId } from "@/lib/city/load-stages";

/**
 * The Laden → Erster Frame handover, as a set of shared-element names.
 *
 * Nothing crossfades and nothing new appears: the pill is made of the three
 * things already on screen. The dark surface shrinks from full-bleed into the
 * pill, the plate stack flattens into the pill's stacked-bar glyph, and each
 * layer swatch stretches into its progress segment. React pairs an unmounting
 * `<ViewTransition name>` with a mounting one of the same name and animates
 * between the two boxes ("share"), so the loading screen and the pill can be
 * separate components that never exist at the same time.
 *
 * The browser animation itself is CSS: `app/globals.css` styles
 * `::view-transition-group(.hud-morph)`. Where `startViewTransition` is
 * missing the state still flips — the pill simply appears, and its own CSS
 * entrance animation covers it (see the `@supports` block there).
 */

/** view-transition-class on every morphing pair; the CSS times them together. */
export const HANDOVER_SHARE_CLASS = "hud-morph";

/** The full-bleed loading surface ↔ the pill's background. */
export const HANDOVER_SURFACE_NAME = "hud-surface";

/** The stack of layer plates ↔ the pill's three-bar glyph. */
export const HANDOVER_STACK_NAME = "hud-stack";

/** One layer's swatch in the list ↔ its segment in the pill. */
export function HANDOVER_SEGMENT_NAME(stage: LoadStageId): string {
  return `hud-seg-${stage}`;
}
