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
  show: (view: ViewpointGeometry) => void;
  /** the player's pose, mode, time, style and layers, for the model */
  where: () => Record<string, unknown>;
  /** asks what stands at the centre of the view (and opens its card) */
  look: () => Record<string, unknown>;
  /** the Hörmodus: the scene barely draws while the visitor listens */
  setListening: (on: boolean) => void;
}

/** The tools the browser runs, bound to the scene. */
export function sceneTools(scene: AskScene) {
  return clientTools(
    whereTool.client(() => scene.where()),
    lookTool.client(() => scene.look()),
    showTool.client((input) => {
      const target: AskTarget = input;
      scene.show(
        askView(target, scene.from() ?? target, input.aus_der_luft ?? false)
      );
      return { ok: true };
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
