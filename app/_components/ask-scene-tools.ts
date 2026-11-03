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
  timeTool,
  whereTool,
} from "@/lib/city/ask-tools";
import { type AskTarget, askView } from "@/lib/city/ask-view";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { RenderStyle } from "@/lib/city/render-style";
import type { ViewpointGeometry } from "@/lib/city/site";

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
  /** glides to a view; false while there is no scene to move */
  show: (view: ViewpointGeometry) => boolean;
  /** whether a point (site CRS) lies on one of the site's tiles */
  within: (x: number, y: number) => boolean;
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
    lookTool.client(async () => scene.look()),
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
