import type { ViewTransitionClass } from "react";
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
 * **Everything here is scoped to one transition type.** The HUD updates
 * constantly while the scene streams — a byte of terrain, a landed tile, a new
 * FPS reading — and those updates are transitions too (see city-walk.tsx:
 * urgent updates at that rate starve the handover and it lands ten seconds
 * late). Tagging the one update that should animate with
 * `addTransitionType(HANDOVER_TYPE)` and declaring `default: "none"` on every
 * class below means the morph runs for that update and no other: a segment
 * filling by 3 % must not trigger a 1.4 s shared-element animation.
 *
 * The animation itself is CSS: `app/globals.css` styles
 * `::view-transition-group(.hud-morph)`. Where `startViewTransition` is
 * missing the state still flips — the pill simply appears, and its own CSS
 * entrance animation covers it (see the `@supports` block there).
 */

/** The transition type the handover is tagged with. */
export const HANDOVER_TYPE = "hud-handover";

/** The morphing pairs: surface, stack and the six swatches. */
export const HANDOVER_SHARE: ViewTransitionClass = {
  [HANDOVER_TYPE]: "hud-morph",
  default: "none",
};

/** The loading copy, which leaves before the pill's own text arrives. */
export const HANDOVER_EXIT: ViewTransitionClass = {
  [HANDOVER_TYPE]: "hud-fade-out",
  default: "none",
};

/** The pill-only text, which arrives last. */
export const HANDOVER_ENTER: ViewTransitionClass = {
  [HANDOVER_TYPE]: "hud-fade-in",
  default: "none",
};

/** The full-bleed loading surface ↔ the pill's background. */
export const HANDOVER_SURFACE_NAME = "hud-surface";

/** The stack of layer plates ↔ the pill's three-bar glyph. */
export const HANDOVER_STACK_NAME = "hud-stack";

/** One layer's swatch in the list ↔ its segment in the pill. */
export function handoverSegmentName(stage: LoadStageId): string {
  return `hud-seg-${stage}`;
}
