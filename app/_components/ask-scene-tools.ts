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
  showTool,
  styleTool,
  timeProblem,
  timeTool,
  whereTool,
} from "@/lib/city/ask-tools";
import { askView } from "@/lib/city/ask-view";
import type { AskTarget } from "@/lib/city/ask-view";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { RenderStyle } from "@/lib/city/render-style";
import type { ViewpointGeometry } from "@/lib/city/site";

/** A change of the scene's time, as `setze_zeit` takes it. */
export interface TimeChange {
  /** YYYY-MM-DD */
  datum?: string;
  /** HH:MM */
  uhrzeit?: string;
}

/** What the card may do to the scene: the scene tools' other half. */
export interface AskScene {
  /** where the camera stands now (site CRS), or null before the scene */
  from: () => { x: number; y: number } | null;
  /** switches a data layer; false where the site has none of that kind */
  setLayer: (key: DataLayerKey, on: boolean) => boolean;
  setStyle: (style: RenderStyle) => void;
  /** the scene's time to a time of day and a date, in the city's clock;
   *  what is left out stays. The instant it set, as text, and why the
   *  picture does not follow where the style keeps its own light. */
  setTime: (change: TimeChange) => { hinweis?: string; zeit: string };
  /** glides to a view; false while there is no scene to move */
  show: (view: ViewpointGeometry) => boolean;
  /** whether a point (site CRS) lies on one of the site's tiles */
  within: (x: number, y: number) => boolean;
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

/** The tools the browser runs, bound to the scene. */
export function sceneTools(scene: AskScene) {
  return clientTools(
    whereTool.client(() => scene.where()),
    lookTool.client(
      async (_input, context) => await scene.look(context?.abortSignal)
    ),
    showTool.client((input) => {
      const target: AskTarget = input;
      if (!scene.within(target.x, target.y)) {
        return { ok: false, ausserhalb: true, hinweis: OUTSIDE };
      }
      return scene.show(
        askView(target, scene.from() ?? target, input.aus_der_luft ?? false)
      )
        ? { ok: true }
        : { ok: false, hinweis: "Die Szene lädt noch." };
    }),
    timeTool.client(({ uhrzeit, datum }) => {
      if (!(uhrzeit || datum)) {
        return { ok: false, hinweis: "Gib eine Uhrzeit oder ein Datum an." };
      }
      const problem = timeProblem({ uhrzeit, datum });
      return problem
        ? { ok: false, hinweis: problem }
        : { ok: true, ...scene.setTime({ uhrzeit, datum }) };
    }),
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
