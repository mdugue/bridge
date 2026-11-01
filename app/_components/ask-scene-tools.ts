/**
 * *Frag die Stadt*'s scene on the browser's side (ADR 0056, 0057): what
 * the card may do to the scene, the one tool the browser answers
 * (`was_ist_da`) and how `zeige` frames its places. In the card's chunk,
 * not the scene's: it carries the tool schemas.
 */
import { clientTools } from "@tanstack/ai-client";
import { showAnswer } from "@/lib/city/ask-shown";
import { lookTool } from "@/lib/city/ask-tools";
import {
  type AskTarget,
  type FrameContext,
  frameTargets,
  streetView,
} from "@/lib/city/ask-view";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { RenderStyle } from "@/lib/city/render-style";
import type { PlannedVolume, River } from "@/lib/city/scenario";
import type { ViewpointGeometry } from "@/lib/city/site";
import type { StarterContext } from "@/lib/city/ask-starters";

/** What the card may do to the scene: the scene tools' other half. */
export interface AskScene {
  /** where the camera stands now (site CRS), or null before the scene */
  from: () => { x: number; y: number } | null;
  /** switches a data layer; false where the site has none of that kind */
  setLayer: (key: DataLayerKey, on: boolean) => boolean;
  setStyle: (style: RenderStyle) => void;
  /** the scene's time to `hour` (of `date`, YYYY-MM-DD, or today's day);
   *  the instant it set, as text */
  setTime: (hour: number, date?: string) => string;
  show: (view: ViewpointGeometry) => void;
  /** selects what stands at each place (site CRS), as Shift+click does:
   *  the places an answer shows */
  select: (places: readonly { r?: number; x: number; y: number }[]) => void;
  /** what the framing reads of the moment: the screen, the sun, the
   *  loaded buildings' sight lines (lib/city/ask-view.ts) */
  frame: () => Omit<FrameContext, "from">;
  /** what the first questions read of the moment (plan 081) */
  moment: () => StarterContext;
  /** the player's pose, mode, time, style and layers, for the model */
  where: () => Record<string, unknown>;
  /** asks what stands at the centre of the view (and opens its card) */
  look: () => Record<string, unknown>;
  /** the Hörmodus: the scene barely draws while the visitor listens */
  setListening: (on: boolean) => void;
  /** the site's river with its gauges, where it has one (ADR 0058) */
  river: River | null;
  /** the river's water at `cm` on its reference gauge; null takes it away */
  setFlood: (cm: number | null) => void;
  /** a planned volume in the scene, null takes it away; false where
   *  no loaded ground lies under it */
  setVolume: (volume: PlannedVolume | null) => boolean;
}

/** The tools the browser answers, bound to the scene: `was_ist_da`
 *  alone, a ray through the crosshair. The view-changing ones the server
 *  acknowledges and the card carries out from the stream (ask-effects.ts). */
export function sceneTools(scene: AskScene) {
  return clientTools(lookTool.client(() => scene.look()));
}

/** A place `zeige` names: where it is, what it is called. */
export type AskPlace = AskTarget & { name: string };

/**
 * Flies to `places` — every one in one view, or the first alone (`alle`
 * false, or spread too far for one: `showAnswer`, which the server
 * answered the model with) — and says what it showed. On foot the
 * walker stands before the first. What it names is selected: every
 * place with `alle` (spread too far, their cards are a click apart in
 * the selection), the first alone without.
 */
export function showPlaces(
  scene: AskScene,
  ask: { alle?: boolean; aus_der_luft?: boolean; ziele: readonly AskPlace[] }
): Record<string, unknown> {
  const [first] = ask.ziele;
  const from = scene.from();
  const answer = showAnswer(ask);
  scene.select(
    ask.alle !== false && ask.ziele.length > 1 ? ask.ziele : [first]
  );
  if (ask.aus_der_luft === false) {
    scene.show(streetView(first, from ?? first, scene.frame().groundAt));
    return answer;
  }
  const shown = (answer.gezeigt as unknown[]).length;
  const framed = frameTargets(ask.ziele.slice(0, shown), {
    ...scene.frame(),
    from,
  });
  scene.show(framed.view);
  return { ...answer, abstand_m: framed.distance };
}
