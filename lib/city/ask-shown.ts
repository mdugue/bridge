/**
 * What *Frag die Stadt*'s view-changing tools (`SHOWN_TOOLS`, ADR 0056)
 * answer and do, as pure functions both sides run: the server answers
 * the model with them at once (ask-run.ts), and the card carries the
 * same call out on the scene when it arrives in the stream
 * (app/_components/ask-effects.ts) — so the answer says what the card
 * does, and the model writes on without a round trip through the
 * browser and another model turn for each.
 */
import { AERIAL_REACH, type AskTarget, frameTargets } from "./ask-view";
import {
  clampVolume,
  floodReading,
  levelAtReference,
  type PlannedVolume,
  type River,
  SCENARIO_NOTE,
} from "./scenario";

/** What the model gets back for a call. */
export type ToolAnswer = Record<string, unknown>;

/** The screen's shape the rule assumes where the browser names none:
 *  square, between a phone held upright and a desktop. */
export const DEFAULT_ASPECT = 1;

/**
 * Whether `places` fit one aerial view on a screen of `aspect`: the
 * distance the framing needs for all of them (`frameTargets`, on flat
 * ground, from no side in particular) within AERIAL_REACH. The server
 * answers `zeige` with it, the card shows with it — so both say the same.
 */
export function fitsOneView(
  places: readonly AskTarget[],
  aspect: number = DEFAULT_ASPECT
): boolean {
  return frameTargets(places, { aspect, from: null }).distance <= AERIAL_REACH;
}

/** `zeige`'s answer: what the view will show — all places in one view,
 *  or the first alone (`alle` false, on foot, or too far apart for one
 *  view on the visitor's screen: `fitsOneView`). */
export function showAnswer(
  ask: {
    alle?: boolean;
    aus_der_luft?: boolean;
    ziele: readonly (AskTarget & { name: string })[];
  },
  aspect?: number
): ToolAnswer {
  const names = ask.ziele.map((p) => p.name);
  const all = ask.alle !== false && names.length > 1;
  if (ask.aus_der_luft === false || !all) {
    return { ok: true, gezeigt: names.slice(0, 1), knoepfe: names };
  }
  return fitsOneView(ask.ziele, aspect)
    ? { ok: true, gezeigt: names, knoepfe: names }
    : {
        ok: true,
        gezeigt: names.slice(0, 1),
        knoepfe: names,
        hinweis:
          "Die Orte liegen zu weit auseinander für eine Ansicht: gezeigt ist der erste, die anderen stehen als Knöpfe unter der Antwort.",
      };
}

/** An hour of the day as minutes, as the scene's clock takes it: within
 *  the day, 24 its last minute. */
export function clockMinutes(hour: number): number {
  const minutes = Math.round(Math.min(Math.max(hour, 0), 24) * 60);
  return Math.min(minutes, 24 * 60 - 1);
}

/** `setze_zeit`'s answer: the hour as the scene's clock sets it, and the
 *  day (the tool's schema holds it to a calendar day). */
export function timeAnswer(ask: { datum?: string; stunde: number }) {
  const minutes = clockMinutes(ask.stunde);
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { ok: true, zeit: `${ask.datum ?? "heute"}, ${clock} Uhr` };
}

/** `datenschicht`'s answer: whether the site has that layer at all. */
export function layerAnswer(
  layers: readonly string[],
  ask: { schicht: string }
): ToolAnswer {
  return layers.includes(ask.schicht)
    ? { ok: true }
    : { ok: false, hinweis: "Diese Stadt hat diese Ebene nicht." };
}

/** `zeige_hochwasser`: the answer, and the reading the card sets — a
 *  level (cm), null to take the water away, undefined for no change. */
export function floodShown(
  river: River | null,
  ask: { aus?: boolean; ereignis?: string; pegel_cm?: number }
): { answer: ToolAnswer; cm: number | null | undefined } {
  if (ask.aus) {
    return { answer: { ok: true }, cm: null };
  }
  if (!river) {
    return {
      answer: {
        ok: false,
        hinweis: "Für diese Stadt hat das Stadtmodell keine Pegeldaten.",
      },
      cm: undefined,
    };
  }
  const reading = floodReading(river, ask);
  if (!reading) {
    return {
      answer: {
        ok: false,
        ereignisse: river.events.map((e) => `${e.id}: ${e.label}`),
      },
      cm: undefined,
    };
  }
  return {
    answer: {
      ok: true,
      pegel_cm: reading.cm,
      ...(reading.event ? { ereignis: reading.event.label } : {}),
      wasserspiegel_am_pegel_m_nhn:
        Math.round(levelAtReference(river, reading.cm) * 100) / 100,
      hinweis: SCENARIO_NOTE,
    },
    cm: reading.cm,
  };
}

/** `plane_baukoerper`: the answer, and the volume the card places —
 *  null takes it away, undefined for no change. */
export function volumeShown(ask: Partial<PlannedVolume> & { aus?: boolean }): {
  answer: ToolAnswer;
  volume: PlannedVolume | null | undefined;
} {
  if (ask.aus) {
    return { answer: { ok: true }, volume: null };
  }
  const { x, y, breite, tiefe, hoehe } = ask;
  if (
    x === undefined ||
    y === undefined ||
    breite === undefined ||
    tiefe === undefined ||
    hoehe === undefined
  ) {
    return {
      answer: { ok: false, fehler: "x, y, breite, tiefe und hoehe fehlen." },
      volume: undefined,
    };
  }
  const volume = clampVolume({
    x,
    y,
    breite,
    tiefe,
    hoehe,
    drehung: ask.drehung ?? 0,
  });
  return {
    answer: {
      ok: true,
      baukoerper: volume,
      // the card places it once the ground there has loaded
      hinweis: `Der Quader erscheint, sobald dort das Gelände geladen ist — zeig den Ort mit zeige, wenn er nicht im Bild ist. ${SCENARIO_NOTE}`,
    },
    volume,
  };
}
