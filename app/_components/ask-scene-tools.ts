/**
 * *Frag die Stadt*'s scene tools on the browser's side (ADR 0056, 0057):
 * each tool the server hands the browser, bound to what the card may do
 * to the scene. In the card's chunk, not the scene's: it carries the
 * tool schemas.
 */
import { clientTools } from "@tanstack/ai-client";
import {
  layerTool,
  lookTool,
  SHOW_TARGETS,
  showTool,
  styleTool,
  timeTool,
  whereTool,
} from "@/lib/city/ask-tools";
import {
  type AskTarget,
  type FrameContext,
  frameTargets,
  streetView,
} from "@/lib/city/ask-view";
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
  setStyle: (style: RenderStyle) => void;
  /** the scene's time to `hour` (of `date`, YYYY-MM-DD, or today's day);
   *  the instant it set, as text */
  setTime: (hour: number, date?: string) => string;
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
  /** what the first questions read of the moment (plan 081) */
  moment: () => StarterContext;
  /** the player's pose, mode, time, style and layers, for the model */
  where: () => Record<string, unknown>;
  /** asks what stands at the centre of the view (and opens its card) */
  look: () => Promise<Record<string, unknown>>;
  /** ends the scene tools' waits (a stopped answer, a closed card) */
  abandon: () => void;
  /** the Hörmodus: the scene barely draws while the visitor listens */
  setListening: (on: boolean) => void;
}

/** The tools the browser runs, bound to the scene. */
export function sceneTools(scene: AskScene) {
  return clientTools(
    whereTool.client(() => scene.where()),
    lookTool.client(() => scene.look()),
    showTool.client((input) => showPlaces(scene, input)),
    timeTool.client(({ stunde, datum }) => ({
      ok: true,
      zeit: scene.setTime(stunde, datum),
    })),
    styleTool.client(({ stil }) => {
      scene.setStyle(stil);
      return { ok: true };
    }),
    layerTool.client(({ schicht, an }) =>
      scene.setLayer(schicht, an)
        ? { ok: true }
        : { ok: false, hinweis: "Diese Stadt hat diese Ebene nicht." }
    )
  );
}

/** What the model hears for a point off the city's tiles: often a
 *  latitude/longitude or swapped axes. */
const OUTSIDE =
  "Dieser Punkt liegt nicht in der Stadt. x ist der Rechtswert, y der Hochwert in Metern, wie suche_stadt sie liefert — keine Grad.";

/** What the model hears while there is no scene to move yet. */
const LOADING = { ok: false, hinweis: "Die Szene lädt noch." };

/** A place `zeige` names: where it is, what it is called. */
export type AskPlace = AskTarget & { name: string };

/**
 * The farthest an aerial view of several places stands off them (m):
 * beyond it a 20 m house is a few pixels on a phone and the fog nears
 * (on a phone the stream ends at 2.2 km). Further spread places are
 * shown one at a time, from their chips.
 */
export const AERIAL_REACH = 900;

/**
 * Flies to `places` — every one in one view, or the first alone (`alle`
 * false, or spread too far for one) — and says what it showed. On foot
 * the walker stands before the first. A place off the city's tiles is
 * left out; none on them is refused. What it shows is selected: every
 * place with `alle` (spread too far, their cards are a click apart in
 * the selection), the first alone without.
 */
export function showPlaces(
  scene: AskScene,
  ask: { alle?: boolean; aus_der_luft?: boolean; ziele: readonly AskPlace[] }
): Record<string, unknown> {
  const places = ask.ziele
    .filter((p) => scene.within(p.x, p.y))
    .slice(0, SHOW_TARGETS);
  const [first] = places;
  if (!first) {
    return { ok: false, ausserhalb: true, hinweis: OUTSIDE };
  }
  const from = scene.from();
  const all = ask.alle !== false && places.length > 1;
  scene.select(all ? places : [first]);
  if (ask.aus_der_luft === false) {
    return scene.show(streetView(first, from ?? first, scene.frame().groundAt))
      ? { ok: true, gezeigt: [first.name] }
      : LOADING;
  }
  const context = { ...scene.frame(), from };
  const framed = all ? frameTargets(places, context) : null;
  if (framed && framed.distance <= AERIAL_REACH) {
    return scene.show(framed.view, framed.ground)
      ? {
          ok: true,
          gezeigt: places.map((p) => p.name),
          abstand_m: framed.distance,
        }
      : LOADING;
  }
  const alone = frameTargets([first], context);
  if (!scene.show(alone.view, alone.ground)) {
    return LOADING;
  }
  return {
    ok: true,
    gezeigt: [first.name],
    abstand_m: alone.distance,
    ...(framed
      ? {
          hinweis:
            "Die Orte liegen zu weit auseinander für eine Ansicht: gezeigt ist der erste, die anderen stehen als Knöpfe unter der Antwort.",
        }
      : {}),
  };
}
