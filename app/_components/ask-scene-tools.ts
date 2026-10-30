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
import {
  type AskTarget,
  type FrameContext,
  frameTargets,
  streetView,
} from "@/lib/city/ask-view";
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
  /** selects what stands at each place (site CRS), as Shift+click does:
   *  the places an answer shows */
  select: (places: readonly { r?: number; x: number; y: number }[]) => void;
  /** what the framing reads of the moment: the screen, the sun, the
   *  loaded buildings' sight lines (lib/city/ask-view.ts) */
  frame: () => Omit<FrameContext, "from">;
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
    ),
    floodShowTool.client((ask) => showFlood(scene, ask)),
    volumeTool.client((ask) => placeVolume(scene, ask))
  );
}

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
 * the walker stands before the first. What it names is selected: every
 * place with `alle` (spread too far, their cards are a click apart in
 * the selection), the first alone without.
 */
export function showPlaces(
  scene: AskScene,
  ask: { alle?: boolean; aus_der_luft?: boolean; ziele: readonly AskPlace[] }
): Record<string, unknown> {
  const [first] = ask.ziele;
  const from = scene.from();
  const all = ask.alle !== false && ask.ziele.length > 1;
  scene.select(all ? ask.ziele : [first]);
  if (ask.aus_der_luft === false) {
    scene.show(streetView(first, from ?? first));
    return { ok: true, gezeigt: [first.name] };
  }
  const context = { ...scene.frame(), from };
  const framed = all ? frameTargets(ask.ziele, context) : null;
  if (framed && framed.distance <= AERIAL_REACH) {
    scene.show(framed.view);
    return {
      ok: true,
      gezeigt: ask.ziele.map((p) => p.name),
      abstand_m: framed.distance,
    };
  }
  const alone = frameTargets([first], context);
  scene.show(alone.view);
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

function placeVolume(
  scene: AskScene,
  ask: Partial<PlannedVolume> & { aus?: boolean }
): Record<string, unknown> {
  if (ask.aus) {
    scene.setVolume(null);
    return { ok: true };
  }
  const { x, y, breite, tiefe, hoehe } = ask;
  if (
    x === undefined ||
    y === undefined ||
    breite === undefined ||
    tiefe === undefined ||
    hoehe === undefined
  ) {
    return { ok: false, fehler: "x, y, breite, tiefe und hoehe fehlen." };
  }
  const v = clampVolume({
    x,
    y,
    breite,
    tiefe,
    hoehe,
    drehung: ask.drehung ?? 0,
  });
  if (!scene.setVolume(v)) {
    return {
      ok: false,
      hinweis:
        "Dort ist das Gelände noch nicht geladen — erst mit zeige hinfliegen, dann noch einmal.",
    };
  }
  return { ok: true, baukoerper: v, hinweis: SCENARIO_NOTE };
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
