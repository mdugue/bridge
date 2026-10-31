/**
 * The Szenario-Assistent's server tools (ADR 0058): the flood and shadow
 * numbers worked out over a site's Stadtwissen, cut to what a model needs
 * — counts, the few deepest or most shaded by name, and the note that it
 * is a model's sum, not an official result. Pure, like ask-knowledge.ts.
 */
import { ASK_LIMITS } from "./ask-city";
import type { Knowledge } from "./ask-knowledge";
import {
  clampVolume,
  depthBands,
  floodReading,
  floodSurface,
  levelAtReference,
  type Neighbour,
  type PlannedVolume,
  riverOf,
  SCENARIO_NOTE,
  shadedHours,
  shadowStudy,
} from "./scenario";

/** How far a base may lie below the gauge zero line and still count (m). */
export const DEEPEST_BELOW_ZERO_M = 6;

const NO_RIVER = {
  fehler:
    "Für diese Stadt hat das Stadtmodell keine Pegeldaten; Hochwasser lässt sich hier nicht rechnen.",
};

interface FloodAsk {
  ereignis?: string;
  pegel_cm?: number;
  radius?: number;
  x?: number;
  y?: number;
}

/** What a flood at the asked reading would reach, in counts and names. */
export function floodAffected(
  k: Knowledge,
  siteId: string,
  epsg: number,
  ask: FloodAsk
): Record<string, unknown> {
  const river = riverOf(siteId);
  if (!river) {
    return NO_RIVER;
  }
  const reading = floodReading(river, ask);
  if (!reading) {
    return {
      fehler: "Ereignis oder pegel_cm fehlt.",
      ereignisse: river.events.map((e) => `${e.id}: ${e.label}, ${e.cm} cm`),
    };
  }
  const surface = floodSurface(river, epsg, reading.cm);
  const centre =
    ask.x !== undefined && ask.y !== undefined
      ? { x: ask.x, y: ask.y, r: ask.radius ?? 1000 }
      : null;
  const within = (p: { x: number; y: number }) =>
    !centre || Math.hypot(p.x - centre.x, p.y - centre.y) <= centre.r;
  // a base far below the river's own bed is a fault of the data (a
  // building's z of 60 m in a valley at 110), not a deep flood
  const plausible = (depth: number) =>
    depth > 0 && depth <= reading.cm / 100 + DEEPEST_BELOW_ZERO_M;
  const wet = k.buildings.flatMap((b) => {
    if (!within(b)) {
      return [];
    }
    const depth = surface(b.x, b.y) - b.z;
    return plausible(depth) ? [{ b, depth }] : [];
  });
  // deepest first, each name once (an ensemble's parts share theirs)
  const seen = new Set<string>();
  const named = wet
    .filter(({ b }) => b.name !== undefined || b.addr !== undefined)
    .sort((a, b) => b.depth - a.depth)
    .filter(({ b }) => {
      const key = (b.name ?? b.addr) as string;
      const fresh = !seen.has(key);
      seen.add(key);
      return fresh;
    })
    .slice(0, ASK_LIMITS.results)
    .map(({ b, depth }) => ({
      name: b.name ?? b.addr,
      id: b.id,
      x: Math.round(b.x),
      y: Math.round(b.y),
      wassertiefe_m: Math.round(depth * 10) / 10,
    }));
  const landmarks = k.index.landmarks.flatMap((lm) => {
    if (lm.z === undefined || !within(lm)) {
      return [];
    }
    const depth = surface(lm.x, lm.y) - lm.z;
    return plausible(depth)
      ? [
          {
            name: lm.name,
            id: lm.id,
            wassertiefe_m: Math.round(depth * 10) / 10,
          },
        ]
      : [];
  });
  return {
    fluss: river.name,
    pegel: river.reference,
    pegel_cm: reading.cm,
    ...(reading.event
      ? { ereignis: reading.event.label, scheitel: reading.event.when }
      : {}),
    wasserspiegel_am_pegel_m_nhn:
      Math.round(levelAtReference(river, reading.cm) * 100) / 100,
    normal_cm: river.normalCm,
    ...(centre ? { umkreis_m: centre.r } : {}),
    gebaeude_unter_wasser: wet.length,
    gebaeude_gesamt: k.buildings.filter(within).length,
    nach_tiefe: depthBands(wet.map((w) => w.depth)),
    tiefste_benannte: named,
    wahrzeichen: landmarks.slice(0, ASK_LIMITS.results),
    gezaehlt:
      "Gebäude, die das Stadtwissen kennt: mit Namen, Adresse, Denkmalschutz oder als Teil eines Wahrzeichens — Schuppen, Garagen und Nebengebäude ohne Adresse fehlen.",
    annahmen:
      "Wasserspiegel zwischen den Pegeln geradlinig, Gebäude nach dem Gelände an ihrem Fuß; ohne Deiche, Schutzwände, Kanalisation und Zuflüsse (2002 kam in Dresden die Weißeritz dazu); jede Senke unter dem Spiegel gilt als nass.",
    quellen: river.sources,
    hinweis: SCENARIO_NOTE,
  };
}

/** The buildings a shadow study names: named or addressed, near the volume. */
function neighboursOf(k: Knowledge, v: PlannedVolume): Neighbour[] {
  // the longest shadow worth naming: 3° sun, the tallest volume
  const reach = Math.hypot(v.breite, v.tiefe) / 2 + v.hoehe * 19.1;
  return k.buildings.flatMap((b) =>
    (b.name !== undefined || b.addr !== undefined) &&
    Math.hypot(b.x - v.x, b.y - v.y) <= reach
      ? [{ name: (b.name ?? b.addr) as string, x: b.x, y: b.y }]
      : []
  );
}

/** A planned volume's shadow through a day, and whom it falls on. */
export function shadowAnswer(
  k: Knowledge,
  epsg: number,
  ask: PlannedVolume & { datum: string }
): Record<string, unknown> {
  const v = clampVolume(ask);
  const hours = shadowStudy(v, ask.datum, epsg, neighboursOf(k, v));
  if (hours.length === 0) {
    return {
      fehler:
        "An diesem Tag steht die Sonne nie hoch genug, oder der Ort liegt außerhalb.",
    };
  }
  const cap = ASK_LIMITS.results;
  return {
    datum: ask.datum,
    zeitzone:
      "Ortszeit der Stadt (MEZ/MESZ); setze_zeit stellt die Uhr des Besuchers, die außerhalb Deutschlands abweichen kann",
    baukoerper: v,
    stunden: hours.map((h) => ({
      ...h,
      verschattet: h.verschattet.slice(0, cap),
    })),
    nachbarn_im_schatten: shadedHours(hours).slice(0, cap),
    annahmen:
      "Ebenes Gelände in Höhe des Fußpunkts, Nachbarn nach ihrem Mittelpunkt, nur benannte oder adressierte Gebäude; die Schatten der Nachbarn selbst sind nicht gerechnet.",
    hinweis: SCENARIO_NOTE,
  };
}
