/**
 * *Frag die Stadt*'s scene tools on the browser's side (ADR 0056, 0057):
 * each tool the server hands the browser, bound to what the card may do
 * to the scene. In the card's chunk, not the scene's: it carries the
 * tool schemas.
 */
import { clientTools } from "@tanstack/ai-client";
import {
  floodShowTool,
  layerTool,
  lookTool,
  showTool,
  styleTool,
  timeTool,
  volumeTool,
  whereTool,
} from "@/lib/city/ask-tools";
import { type AskTarget, askView } from "@/lib/city/ask-view";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { RenderStyle } from "@/lib/city/render-style";
import {
  clampVolume,
  floodReading,
  levelAtReference,
  type PlannedVolume,
  type River,
  SCENARIO_NOTE,
} from "@/lib/city/scenario";
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
  /** the site's river with its gauges, where it has one (ADR 0058) */
  river: River | null;
  /** the river's water at `cm` on its reference gauge; null takes it away */
  setFlood: (cm: number | null) => void;
  /** a planned volume in the scene; null takes it away */
  setVolume: (volume: PlannedVolume | null) => void;
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
    ),
    floodShowTool.client((ask) => showFlood(scene, ask)),
    volumeTool.client(({ aus, ...volume }) => {
      if (aus) {
        scene.setVolume(null);
        return { ok: true };
      }
      const v = clampVolume({ ...volume, drehung: volume.drehung ?? 0 });
      scene.setVolume(v);
      return { ok: true, baukoerper: v, hinweis: SCENARIO_NOTE };
    })
  );
}

function showFlood(
  scene: AskScene,
  ask: { aus?: boolean; ereignis?: string; pegel_cm?: number }
): Record<string, unknown> {
  if (ask.aus) {
    scene.setFlood(null);
    return { ok: true };
  }
  const river = scene.river;
  if (!river) {
    return {
      ok: false,
      hinweis: "Für diese Stadt hat das Stadtmodell keine Pegeldaten.",
    };
  }
  const reading = floodReading(river, ask);
  if (!reading) {
    return {
      ok: false,
      ereignisse: river.events.map((e) => `${e.id}: ${e.label}`),
    };
  }
  scene.setFlood(reading.cm);
  return {
    ok: true,
    pegel_cm: reading.cm,
    ...(reading.event ? { ereignis: reading.event.label } : {}),
    wasserspiegel_am_pegel_m_nhn:
      Math.round(levelAtReference(river, reading.cm) * 100) / 100,
    hinweis: SCENARIO_NOTE,
  };
}
