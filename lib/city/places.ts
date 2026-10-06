/**
 * The sidebar's *Orte*: the site's authored vantages and its landmarks
 * (lib/city/landmarks.ts) as ONE list. A landmark a vantage already shows
 * is folded into that vantage — named in it, or standing where it looks
 * down — instead of being listed twice; the rest follow the vantages, the
 * most notable first. No THREE, no DOM.
 */
import { landmarkVantage, type Landmark } from "./landmarks";
import type { MovementMode, Viewpoint, ViewpointGeometry } from "./site";

export interface Place {
  /** the vantage's id, or the landmark's Wikidata id */
  id: string;
  kind: "landmark" | "vantage";
  label: string;
  /** the vantage's line (a landmark has none) */
  description?: string;
  /** walk or fly: how it is seen (a landmark from the air) */
  mode: MovementMode;
  /** the landmarks this place shows too (folded in, named for search) */
  also: string[];
  /** the 1–9 key that travels there too (the first nine vantages) */
  key?: number;
  view: ViewpointGeometry;
}

/** How many places the list shows before it is opened. */
export const PLACES_FIRST = 6;

/** A vantage looking down at least this steeply has a spot it looks at… */
const STEEP_DEG = 20;
/** …and a landmark this close to that spot is what it shows. */
const LOOKS_AT_M = 60;

/** Words that name no place: articles, prepositions, view words. */
const FILLER = new Set([
  "am",
  "an",
  "auf",
  "blick",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "das",
  "im",
  "in",
  "panorama",
  "und",
  "über",
  "vom",
  "von",
  "zum",
  "zur",
]);

/**
 * A name's words, lower-cased and stripped of their German endings
 * ("Japanischen" and "Japanisches" are one word), without fillers, the
 * city's own name ("Dresden Hauptbahnhof" is the Hauptbahnhof) and what
 * Wikidata disambiguates in brackets.
 */
export function placeWords(name: string, city = ""): string[] {
  const own = new Set(city ? placeWords(city) : []);
  return name
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && !FILLER.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(en|es|er|em|e|s|n)$/u, "") : w))
    .filter((w) => !own.has(w));
}

const within = (a: readonly string[], b: readonly string[]): boolean =>
  a.length > 0 && a.every((w) => b.includes(w));

/**
 * Whether a vantage's name names the landmark: every word of the
 * landmark's is in the vantage's ("Zwinger" in "Zwinger & Semperoper"), or
 * the vantage's are all in a landmark's barely longer name ("Hauptbahnhof"
 * in "Dresden Hauptbahnhof").
 */
function namesIt(vantage: readonly string[], landmark: readonly string[]) {
  return (
    within(landmark, vantage) ||
    (within(vantage, landmark) && landmark.length <= vantage.length + 1)
  );
}

/** Where a steep vantage looks on level ground (EPSG), or null. */
function lookedAt(v: Viewpoint): { x: number; y: number } | null {
  if (v.pitchDeg > -STEEP_DEG) {
    return null;
  }
  const back = v.aboveGround / Math.tan((-v.pitchDeg * Math.PI) / 180);
  const h = (v.headingDeg * Math.PI) / 180;
  return {
    x: v.epsg.x + Math.sin(h) * back,
    y: v.epsg.y + Math.cos(h) * back,
  };
}

function geometryOf(v: Viewpoint): ViewpointGeometry {
  const { aboveGround, epsg, fov, headingDeg, mode, pitchDeg } = v;
  return { aboveGround, epsg, fov, headingDeg, mode, pitchDeg };
}

/**
 * The site's places: its vantages in their authored order (the author put
 * the best first; the first nine keep their keys), each with the
 * landmarks it shows, then the landmarks no vantage shows, most notable
 * first.
 */
export function sitePlaces(
  viewpoints: readonly Viewpoint[],
  landmarks: readonly Landmark[],
  city = ""
): Place[] {
  const vantages = viewpoints.map((v, index) => ({
    v,
    index,
    words: placeWords(v.label, city),
    at: lookedAt(v),
    also: [] as string[],
  }));
  const rest: Landmark[] = [];
  for (const lm of landmarks) {
    const names = [lm.name, ...(lm.also ?? [])].map((n) => placeWords(n, city));
    const shownBy =
      vantages.find((s) => names.some((words) => namesIt(s.words, words))) ??
      vantages.find(
        (s) =>
          s.at !== null &&
          Math.hypot(lm.x - s.at.x, lm.y - s.at.y) <= LOOKS_AT_M
      );
    if (shownBy) {
      shownBy.also.push(lm.name, ...(lm.also ?? []));
    } else {
      rest.push(lm);
    }
  }
  return [
    ...vantages.map(({ v, index, also }): Place => ({
      id: v.id,
      kind: "vantage",
      label: v.label,
      description: v.description,
      mode: v.mode,
      also,
      ...(index < 9 ? { key: index + 1 } : {}),
      view: geometryOf(v),
    })),
    ...rest.map((lm): Place => ({
      id: lm.id,
      kind: "landmark",
      label: lm.name,
      mode: "fly",
      also: lm.also ?? [],
      view: landmarkVantage(lm),
    })),
  ];
}

/**
 * The places a search keeps: every word typed is in the place's name or in
 * a landmark's folded into it, in any order and anywhere in a word — a
 * German name is often one compound ("galerie" finds the
 * Gemäldegalerie, and with it Zwinger & Semperoper).
 */
export function filterPlaces(places: readonly Place[], query: string): Place[] {
  const typed = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  if (typed.length === 0) {
    return [...places];
  }
  return places.filter((p) => {
    const names = [p.label, ...p.also].join(" ").toLowerCase();
    return typed.every((t) => names.includes(t));
  });
}
