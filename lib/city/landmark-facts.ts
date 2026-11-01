/**
 * What a landmark's nameplate says under its name
 * (pipeline/bake/landmark_facts.py → `landmark-facts.json`, Wikidata,
 * CC0): when it was built and by whom, when it was rebuilt, how tall it is.
 * The site's file is fetched on the first landmark asked (ADR 0042) and
 * found by the Buildings it names. No THREE, no DOM.
 */
import type { CardFact } from "./card-lines";

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

/** Building id → the landmarks' facts on it (two items on one building:
 *  an institution in a palace, a church and its parish). */
export type LandmarkFactsIndex = ReadonlyMap<
  string,
  readonly LandmarkFactsEntry[]
>;

export function indexLandmarkFacts(
  file: LandmarkFactsFile
): LandmarkFactsIndex {
  const index = new Map<string, LandmarkFactsEntry[]>();
  for (const entry of file.landmarks) {
    for (const b of entry.buildings) {
      const on = index.get(b);
      if (on) {
        on.push(entry);
      } else {
        index.set(b, [entry]);
      }
    }
  }
  return index;
}

/** The Buildings a building question spans (its ensemble's objects'),
 *  each once: what the card and the nameplate both look its facts up by. */
export function factBuildings(
  tree: readonly { facts: { buildingId: string } }[]
): string[] {
  return [...new Set(tree.map((o) => o.facts.buildingId))];
}

const nameKey = (name: string) =>
  name
    .normalize("NFC")
    .toLocaleLowerCase("de-DE")
    .replaceAll(/\s+/g, " ")
    .trim();

/**
 * The facts of the landmark among `buildings` (a picked ensemble's every
 * Building) the plate names: the one whose name is the card's `title`;
 * else the only one there is; null where several are and none is named
 * so, or none has facts. An institution housed in a palace never lends
 * the palace its founding year.
 */
export function factsFor(
  index: LandmarkFactsIndex,
  buildings: readonly string[],
  title = ""
): LandmarkFactsEntry | null {
  const wanted = nameKey(title);
  const entries = new Set(buildings.flatMap((b) => index.get(b) ?? []));
  const named = [...entries].find(
    (e) => wanted !== "" && nameKey(e.name) === wanted
  );
  if (named) {
    return named;
  }
  // several items and none the card's name (an institution in a palace
  // part the card calls by the part's name): whose facts would be a
  // guess, so none
  if (entries.size !== 1) {
    return null;
  }
  const [only] = entries;
  return only && factCount(only) > 0 ? only : null;
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

/** The inquiry card's rows of a landmark's facts — what its nameplate
 *  says under the name, labelled. */
export function landmarkCardFacts(facts: LandmarkFactsEntry): CardFact[] {
  const rows: CardFact[] = [];
  if (facts.built) {
    rows.push({ label: "Bauzeit", value: span(facts.built) });
  }
  if (facts.architects && facts.architects.length > 0) {
    rows.push({
      label: facts.architects.length > 1 ? "Architekten" : "Architekt",
      value: facts.architects.join(" und "),
    });
  }
  if (facts.rebuilt) {
    rows.push({ label: "Wiederaufbau", value: span(facts.rebuilt) });
  } else if (facts.rebuiltFrom !== undefined) {
    rows.push({ label: "Wiederaufbau", value: `ab ${facts.rebuiltFrom}` });
  }
  if (facts.height !== undefined) {
    rows.push({
      label: "Höhe laut Wikidata",
      value: `${heightFormat.format(facts.height)} m`,
    });
  }
  return rows;
}

/** The source line of a landmark's facts: "Bauzeit, Architekt: Wikidata
 *  Q157229 · CC0". */
export function wikidataSource(what: readonly string[], id: string): string {
  return `${what.join(", ")}: Wikidata ${id} · CC0`;
}
