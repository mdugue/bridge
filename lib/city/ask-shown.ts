/**
 * What *Frag die Stadt*'s view-changing tools (`SHOWN_TOOLS`, ADR 0056)
 * answer and do, as pure functions both sides run: the server answers
 * the model with them at once (ask-run.ts), and the card carries the
 * same call out on the scene when it arrives in the stream
 * (app/_components/ask-effects.ts) — so the answer says what the card
 * does, and the model writes on without a round trip through the
 * browser and another model turn for each.
 */
import { SHOW_TARGETS } from "./ask-tools";
import { AERIAL_REACH, type AskTarget, frameTargets } from "./ask-view";

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

/** What the model hears for a place off the city's tiles: often a
 *  latitude/longitude or swapped axes. */
const OUTSIDE =
  "Dieser Punkt liegt nicht in der Stadt. x ist der Rechtswert, y der Hochwert in Metern, wie suche_stadt sie liefert — keine Grad.";

/** The places `zeige` shows: those on the city's tiles (`holds`), eight
 *  at most. The server answers with them, the card shows them. */
export function placesShown<P extends AskTarget>(
  places: readonly P[],
  holds: (x: number, y: number) => boolean
): P[] {
  return places.filter((p) => holds(p.x, p.y)).slice(0, SHOW_TARGETS);
}

/** `zeige`'s answer: what the view will show — all places on the city in
 *  one view, or the first alone (`alle` false, on foot, or too far apart
 *  for one view on the visitor's screen: `fitsOneView`); refused where
 *  none lies on the city's tiles. */
export function showAnswer(
  ask: {
    alle?: boolean;
    aus_der_luft?: boolean;
    ziele: readonly (AskTarget & { name: string })[];
  },
  aspect?: number,
  holds: (x: number, y: number) => boolean = () => true
): ToolAnswer {
  const places = placesShown(ask.ziele, holds);
  if (places.length === 0) {
    return { ok: false, ausserhalb: true, hinweis: OUTSIDE };
  }
  const names = places.map((p) => p.name);
  const all = ask.alle !== false && names.length > 1;
  if (ask.aus_der_luft === false || !all) {
    return { ok: true, gezeigt: names.slice(0, 1), knoepfe: names };
  }
  return fitsOneView(places, aspect)
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
