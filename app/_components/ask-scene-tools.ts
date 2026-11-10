/**
 * *Frag die Stadt*'s scene on the browser's side (ADR 0056, 0057): what
 * the card may do to the scene, the one tool the browser answers
 * (`was_ist_da`) and how `zeige` frames its places. In the card's chunk,
 * not the scene's: it carries the tool schemas.
 */
import { clientTools } from "@tanstack/ai-client";
import { placesShown, showAnswer } from "@/lib/city/ask-shown";
import { lookTool } from "@/lib/city/ask-tools";
import type { TimeChange } from "@/lib/city/ask-tools";
import { frameTargets, streetView } from "@/lib/city/ask-view";
import type { AskTarget, FrameContext } from "@/lib/city/ask-view";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { RenderStyle } from "@/lib/city/render-style";
import type { ViewpointGeometry } from "@/lib/city/site";
import type { StarterContext } from "@/lib/city/ask-starters";

/** What the card may do to the scene: the scene tools' other half. */
export interface AskScene {
  /** where the camera stands now (site CRS), or null before the scene */
  from: () => { x: number; y: number } | null;
  /** switches a data layer; false where the site has none of that kind */
  setLayer: (key: DataLayerKey, on: boolean) => boolean;
  /** the picture style; why it will not follow the time, where it keeps
   *  its own light */
  setStyle: (style: RenderStyle) => { hinweis?: string };
  /** the scene's time to a time of day and a date, in the city's clock;
   *  what is left out stays. The instant it set, as text, and why the
   *  picture does not follow where the style keeps its own light. */
  setTime: (change: TimeChange) => { hinweis?: string; zeit: string };
  /** glides to a view, its eye over `ground` (m a.s.l.) where given;
   *  false while there is no scene to move */
  show: (view: ViewpointGeometry, ground?: number) => boolean;
  /** whether a point (site CRS) lies on one of the site's tiles */
  within: (x: number, y: number) => boolean;
  /** selects what stands at each place (site CRS), as Shift+click does:
   *  the places an answer shows */
  select: (places: readonly { r?: number; x: number; y: number }[]) => void;
  /** what the framing reads of the moment: the screen, the sun, the
   *  loaded buildings' sight lines (lib/city/ask-view.ts) */
  frame: () => Omit<FrameContext, "from">;
  /** what the first questions read of the moment (plan 085) */
  moment: () => StarterContext;
  /** the player's pose, mode, time, style and layers, for the model */
  where: () => Record<string, unknown>;
  /** asks what stands at the centre of the view (and opens its card);
   *  rejects when `signal` aborts: the chat's `stop()` ends the wait and
   *  drops what the tool ends with, so no stopped answer resumes */
  look: (signal?: AbortSignal) => Promise<Record<string, unknown>>;
  /** the Hörmodus: the scene barely draws while the visitor listens */
  setListening: (on: boolean) => void;
  /** stops the glide an answer started, if it still flies (the stop
   *  button); never one the visitor started since */
  haltAnswerGlide: () => void;
}

/** The tools the browser answers, bound to the scene: `was_ist_da`
 *  alone, a ray through the crosshair. The view-changing ones the server
 *  acknowledges and the card carries out from the stream (ask-effects.ts). */
export function sceneTools(scene: AskScene) {
  return clientTools(
    lookTool.client(
      async (_input, context) => await scene.look(context?.abortSignal)
    )
  );
}

/** What the model hears while there is no scene to move yet. */
const LOADING = { ok: false, hinweis: "Die Szene lädt noch." };

/** A place `zeige` names: where it is, what it is called. */
export type AskPlace = AskTarget & { name: string };

/**
 * Flies to `places` — every one in one view, or the first alone (`alle`
 * false, or too far apart for one on this screen: `showAnswer`, which
 * the server answered the model with for the same screen) — and says
 * what it showed. On foot the walker stands before the first. A place
 * off the city's tiles is left out; none on them is refused. What it
 * names is selected: every
 * place with `alle` (spread too far, their cards are a click apart in
 * the selection), the first alone without. `told`: the places the
 * server's answer said it shows, so the view frames what the model was
 * told even where the screen changed since.
 */
export function showPlaces(
  scene: AskScene,
  ask: { alle?: boolean; aus_der_luft?: boolean; ziele: readonly AskPlace[] },
  told?: readonly string[]
): Record<string, unknown> {
  const places = placesShown(ask.ziele, scene.within);
  const [first] = places;
  if (!first) {
    return showAnswer(ask, undefined, scene.within);
  }
  const from = scene.from();
  const frame = scene.frame();
  const answer = showAnswer({ ...ask, ziele: places }, frame.aspect);
  scene.select(ask.alle !== false && places.length > 1 ? places : [first]);
  if (ask.aus_der_luft === false) {
    return scene.show(streetView(first, from ?? first, frame.groundAt))
      ? answer
      : LOADING;
  }
  const names = told ?? (answer.gezeigt as string[]);
  const framed = frameTargets(
    places.filter((p, i) => i === 0 || names.includes(p.name)),
    { ...frame, from }
  );
  return scene.show(framed.view, framed.ground)
    ? { ...answer, abstand_m: framed.distance }
    : LOADING;
}
