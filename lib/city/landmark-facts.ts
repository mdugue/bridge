/**
 * What a landmark's nameplate says under its name
 * (pipeline/bake/landmark_facts.py → `landmark-facts.json`, Wikidata,
 * CC0): when it was built and by whom, when it was rebuilt, how tall it is.
 * The site's file is fetched on the first landmark asked (ADR 0042) and
 * found by the Buildings it names. No THREE, no DOM.
 */

/** One landmark's facts as the bake writes them. */
export interface LandmarkFactsEntry {
  /** the architects (Wikidata P84), at most two */
  architects?: string[];
  /** the years it was built: [start] or [start, end] */
  built?: number[];
  /** the LoD2 Buildings that are it (the viewer's `buildingId`) */
  buildings: string[];
  /** Wikidata's height (m) */
  height?: number;
  /** Wikidata item id (Q…) */
  id: string;
  name: string;
  /** the years it was rebuilt: [end] or [start, end] */
  rebuilt?: number[];
  /** the year its rebuilding began, where no end is stated */
  rebuiltFrom?: number;
}

export interface LandmarkFactsFile {
  attribution: string;
  landmarks: LandmarkFactsEntry[];
}

/** The committed file (pipeline/bake/landmark_facts.py), and the name
 *  scripts/prepare-data.ts publishes it under (before hashing). */
export function landmarkFactsSource(dataDir: string): string {
  return `${dataDir}/landmark-facts.json`;
}
export const LANDMARK_FACTS_FILE = "landmark-facts.json";

/** What the tileset's extras carry of the file: its URL relative to the
 *  tileset, absent where the site has none. Kept out of lib/city/tileset.ts
 *  (a type there re-bakes every site's ground). */
export interface LandmarkFactsExtras {
  landmarkFacts?: string;
}

/** The file's URL from the tileset's extras, if it names one. */
export function landmarkFactsUrl(extras: unknown): string | null {
  if (typeof extras !== "object" || extras === null) {
    return null;
  }
  const file = (extras as LandmarkFactsExtras).landmarkFacts;
  return typeof file === "string" && file !== "" ? file : null;
}

const isYears = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= 2 &&
  v.every((y) => Number.isInteger(y));

function isEntry(v: unknown): v is LandmarkFactsEntry {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    Array.isArray(e.buildings) &&
    e.buildings.every((b) => typeof b === "string") &&
    (e.built === undefined || isYears(e.built)) &&
    (e.rebuilt === undefined || isYears(e.rebuilt)) &&
    (e.rebuiltFrom === undefined || Number.isInteger(e.rebuiltFrom)) &&
    (e.height === undefined || typeof e.height === "number") &&
    (e.architects === undefined ||
      (Array.isArray(e.architects) &&
        e.architects.every((a) => typeof a === "string")))
  );
}

export function isLandmarkFactsFile(v: unknown): v is LandmarkFactsFile {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const f = v as Record<string, unknown>;
  return (
    typeof f.attribution === "string" &&
    Array.isArray(f.landmarks) &&
    f.landmarks.every(isEntry)
  );
}

/** Building id → its landmark's facts. */
export type LandmarkFactsIndex = ReadonlyMap<string, LandmarkFactsEntry>;

export function indexLandmarkFacts(
  file: LandmarkFactsFile
): LandmarkFactsIndex {
  const index = new Map<string, LandmarkFactsEntry>();
  for (const entry of file.landmarks) {
    for (const b of entry.buildings) {
      // two items on one building (an institution in a palace): the first,
      // the file is sorted by id — the notable one wins below
      if (!index.has(b)) {
        index.set(b, entry);
      }
    }
  }
  return index;
}

/** The facts of the landmark among `buildings` (a picked ensemble's every
 *  Building) that has the most to say; null where none has facts. */
export function factsFor(
  index: LandmarkFactsIndex,
  buildings: readonly string[]
): LandmarkFactsEntry | null {
  let best: LandmarkFactsEntry | null = null;
  let bestScore = 0;
  for (const b of buildings) {
    const entry = index.get(b);
    if (!entry) {
      continue;
    }
    const score = factCount(entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

function factCount(e: LandmarkFactsEntry): number {
  return (
    (e.built ? 2 : 0) +
    (e.rebuilt || e.rebuiltFrom !== undefined ? 1 : 0) +
    (e.architects ? 1 : 0) +
    (e.height === undefined ? 0 : 1)
  );
}

const span = (years: readonly number[]) =>
  years.length > 1 ? `${years[0]}–${years[1]}` : `${years[0]}`;

const heightFormat = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0,
});

/**
 * The nameplate's two lines under the name: "erbaut 1726–1734 · George
 * Bähr" and "wiederaufgebaut 2005 · 91 m" — each fact where it has one, a
 * line without any left out. `drawnHeight` is the model's (the LoD2
 * objects' top above the ground) for a landmark Wikidata gives none.
 */
export function factLines(
  facts: LandmarkFactsEntry | null,
  drawnHeight?: number
): string[] {
  const first: string[] = [];
  const second: string[] = [];
  if (facts?.built) {
    first.push(`erbaut ${span(facts.built)}`);
  }
  if (facts?.architects && facts.architects.length > 0) {
    first.push(facts.architects.join(" und "));
  }
  if (facts?.rebuilt) {
    second.push(`wiederaufgebaut ${span(facts.rebuilt)}`);
  } else if (facts?.rebuiltFrom !== undefined) {
    second.push(`wiederaufgebaut ab ${facts.rebuiltFrom}`);
  }
  const height =
    facts?.height ??
    (drawnHeight !== undefined && drawnHeight >= 1 ? drawnHeight : undefined);
  if (height !== undefined) {
    second.push(`${heightFormat.format(height)} m`);
  }
  return [first, second]
    .filter((line) => line.length > 0)
    .map((line) => line.join(" · "));
}
