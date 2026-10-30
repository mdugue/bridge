/**
 * Stadtwissen: what the twin knows about a city, as files an agent (a
 * walk's author, a chat's tools, a CLI) can read without the scene — a
 * directory of the named, addressed and listed buildings per tile with
 * their position and decoded facts, the site's landmarks with what
 * Wikidata says of them, and the sources each fact comes from. Baked by
 * `scripts/bake-stadtwissen.ts` inside `prepare-data.ts`, from files the
 * build already has (the LoD2, `osmbuild_<tile>.json`, `landmarks_<tile>.json`,
 * `provenance.json`) and the site's committed Wikidata excerpt
 * (`data/<site>/wissen/wikidata.json`, `scripts/fetch-stadtwissen.ts`).
 * No THREE, no DOM.
 */
import type { SourceInfo } from "./provenance";

/** The site-wide index under `public/data/<site>/`. */
export const STADTWISSEN_FILE = "stadtwissen.json";
/**
 * Where the build keeps a copy of each site's Stadtwissen for the server
 * (the chat's tools, ADR 0056), relative to the project: outside
 * `public/`, whose data folders stay out of every server function
 * (next.config.ts). `<dir>/<site>/stadtwissen.json` and the tiles' files
 * under their published names.
 */
export const SERVER_WISSEN_DIR = ".stadtwissen";
/** The committed Wikidata excerpt, relative to the site's data folder. */
export const WIKIDATA_FACTS_FILE = "wissen/wikidata.json";

/** Where a fact comes from: a key of `StadtwissenIndex.sources`. */
export type WissenSource = "lod2" | "osm" | "wikidata";

/** One building of the directory. */
export interface WissenBuilding {
  /** OSM address line */
  addr?: string;
  /** the Building's `gml:id` (ALKIS-derived, the key other data joins on) */
  id: string;
  /** measured height above its base (m), LoD2 */
  h?: number;
  /** OSM `heritage=*` on its outline */
  heritage?: true;
  /** OSM `building:levels` */
  levels?: number;
  /** OSM name of its outline */
  name?: string;
  /** the roof form, AdV Dachform in words, LoD2 */
  roof?: string;
  /** the radius of its footprint: half its LoD2 extent's diagonal (m) */
  r?: number;
  /** a shop or place to eat on its ground floor, OSM */
  shop?: true;
  /** its official use, AdV Gebäudefunktion in words, LoD2 */
  use?: string;
  /** the Wikidata item of the landmark it is part of */
  wd?: string;
  /** centre of its footprint, site CRS (m) */
  x: number;
  y: number;
  /** the ground at its base (m above sea level) */
  z: number;
}

/** A named monument, fountain, column or stone (Basis-DLM, OSM). */
export interface WissenMonument {
  /** `m<x>_<y>`: its position to the metre, the key a walk cites */
  id: string;
  /** statue, fountain, column, stone (monuments.py) */
  kind: string;
  /** its material, where the DLM names one */
  material?: string;
  name: string;
  /** the Wikidata item OSM links it to */
  wd?: string;
  x: number;
  y: number;
}

/** One tile's directory (`stadtwissen_<tile>.json`). */
export interface WissenTile {
  buildings: WissenBuilding[];
  monuments: WissenMonument[];
  tile: string;
}

/** A value of a Wikidata statement: the text, and the item it names. */
export interface WikidataValue {
  /** the item a value names (an architect, a style), when it is one */
  id?: string;
  v: string;
}

/** What the excerpt keeps of one Wikidata item. */
export interface WikidataFacts {
  claims: Partial<Record<WikidataProperty, WikidataValue[]>>;
  description?: string;
  label: string;
  /** the German Wikipedia article's title */
  wiki?: string;
}

/** The committed excerpt (`data/<site>/wissen/wikidata.json`). */
export interface WikidataFile {
  attribution: string;
  entities: Record<string, WikidataFacts>;
  retrieved: string;
}

/**
 * The statements the excerpt keeps, with their German labels: what a
 * walk or a chat can tell about a building without reading the article.
 */
export const WIKIDATA_PROPERTIES = {
  P31: "ist ein(e)",
  P84: "Architekt",
  P88: "Auftraggeber",
  P138: "benannt nach",
  P149: "Baustil",
  P170: "Urheber",
  P186: "Material",
  P466: "genutzt von",
  P571: "Entstehung",
  P576: "aufgelöst oder abgerissen",
  P793: "bedeutendes Ereignis",
  P1083: "Plätze",
  P1435: "Schutzstatus",
  P1449: "Spitzname",
  P1619: "eröffnet",
  P2048: "Höhe",
  P6375: "Adresse",
} as const;
export type WikidataProperty = keyof typeof WIKIDATA_PROPERTIES;

/** A landmark as the index carries it. */
export interface WissenLandmark {
  /** what Wikidata says of it (absent where the excerpt lacks it) */
  facts?: WikidataFacts;
  /** its height above ground (m): drawn or Wikidata's, the taller */
  h: number;
  /** Wikidata item id */
  id: string;
  /** Wikipedia articles about it: how notable it is */
  links: number;
  name: string;
  /** the LoD2 Buildings that draw it */
  objects: string[];
  tile: string;
  x: number;
  y: number;
  z?: number;
}

/** The site-wide index (`stadtwissen.json`). */
export interface StadtwissenIndex {
  epsg: number;
  landmarks: WissenLandmark[];
  site: string;
  sources: Partial<Record<WissenSource, SourceInfo>>;
  /** each tile's directory file, as published */
  tiles: { file: string; id: string }[];
}

// --- Wikidata -------------------------------------------------------------------

interface RawSnak {
  datatype?: string;
  datavalue?: { type: string; value: unknown };
  snaktype: string;
}
interface RawClaim {
  mainsnak: RawSnak;
  rank?: string;
}
/** The part of a `wbgetentities` entity the excerpt reads. */
export interface RawEntity {
  claims?: Record<string, RawClaim[]>;
  descriptions?: Record<string, { value: string }>;
  labels?: Record<string, { value: string }>;
  sitelinks?: Record<string, { title: string }>;
}

const UNITS: Record<string, string> = {
  Q11573: "m",
  Q828224: "km",
  Q25343: "m²",
  Q174728: "cm",
};

/** A Wikidata time value in words: a year, or a day where it is known. */
export function wikidataTime(value: {
  precision: number;
  time: string;
}): string {
  const m = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(value.time);
  if (!m) {
    return value.time;
  }
  const year = Number(m[2]);
  const bc = m[1] === "-" ? " v. Chr." : "";
  if (value.precision >= 11) {
    return `${Number(m[4])}.${Number(m[3])}.${year}${bc}`;
  }
  if (value.precision === 10) {
    return `${Number(m[3])}/${year}${bc}`;
  }
  if (value.precision === 8) {
    return `${Math.floor(year / 10) * 10}er${bc}`;
  }
  if (value.precision === 7) {
    return `${Math.ceil(year / 100)}. Jahrhundert${bc}`;
  }
  return `${year}${bc}`;
}

/** Item ids a statement names (to fetch their labels). */
export function referencedItems(entity: RawEntity): string[] {
  const out = new Set<string>();
  for (const prop of Object.keys(WIKIDATA_PROPERTIES)) {
    for (const claim of entity.claims?.[prop] ?? []) {
      const v = claim.mainsnak.datavalue;
      if (v?.type === "wikibase-entityid") {
        out.add((v.value as { id: string }).id);
      }
      const unit = quantityUnit(v);
      if (unit && !UNITS[unit]) {
        out.add(unit);
      }
    }
  }
  return [...out];
}

function quantityUnit(v: RawSnak["datavalue"]): string | undefined {
  if (v?.type !== "quantity") {
    return undefined;
  }
  const unit = (v.value as { unit: string }).unit;
  return unit === "1" ? undefined : unit.split("/").at(-1);
}

/** A label, German first. */
export function labelOf(entity: RawEntity | undefined): string | undefined {
  return entity?.labels?.de?.value ?? entity?.labels?.en?.value;
}

function snakValue(
  snak: RawSnak,
  labels: Readonly<Record<string, string>>
): WikidataValue | undefined {
  const v = snak.datavalue;
  if (snak.snaktype !== "value" || !v) {
    return undefined;
  }
  switch (v.type) {
    case "wikibase-entityid": {
      const id = (v.value as { id: string }).id;
      const label = labels[id];
      return label ? { id, v: label } : undefined;
    }
    case "time":
      return {
        v: wikidataTime(v.value as { precision: number; time: string }),
      };
    case "quantity": {
      const q = v.value as { amount: string };
      const unit = quantityUnit(v);
      const name = unit ? (UNITS[unit] ?? labels[unit] ?? "") : "";
      return { v: `${Number(q.amount)}${name ? ` ${name}` : ""}` };
    }
    case "monolingualtext": {
      const t = v.value as { language: string; text: string };
      return t.language === "de" || t.language === "en"
        ? { v: t.text }
        : undefined;
    }
    case "string":
      return { v: String(v.value) };
    default:
      return undefined;
  }
}

/**
 * What the excerpt keeps of an entity: the label, the description, the
 * German article and the listed statements (a deprecated one dropped, the
 * preferred ones alone where any is), each value in words.
 */
export function wikidataFacts(
  entity: RawEntity,
  labels: Readonly<Record<string, string>>
): WikidataFacts {
  const claims: WikidataFacts["claims"] = {};
  for (const prop of Object.keys(WIKIDATA_PROPERTIES) as WikidataProperty[]) {
    const all = (entity.claims?.[prop] ?? []).filter(
      (c) => c.rank !== "deprecated"
    );
    const preferred = all.filter((c) => c.rank === "preferred");
    const values = (preferred.length > 0 ? preferred : all)
      .map((c) => snakValue(c.mainsnak, labels))
      .filter((v): v is WikidataValue => v !== undefined);
    if (values.length > 0) {
      claims[prop] = values;
    }
  }
  const description = entity.descriptions?.de?.value;
  const wiki = entity.sitelinks?.dewiki?.title;
  return {
    label: labelOf(entity) ?? "",
    ...(description ? { description } : {}),
    ...(wiki ? { wiki } : {}),
    claims,
  };
}

/** The German article's URL. */
export function wikipediaUrl(title: string): string {
  return `https://de.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

// --- search ----------------------------------------------------------------------

/** Lower case, umlauts and ß spelled out, punctuation to spaces. */
export function foldName(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whether every word of `query` is in the entry's name or address. */
export function matchesQuery(
  entry: { addr?: string; name?: string },
  query: string
): boolean {
  const hay = foldName(`${entry.name ?? ""} ${entry.addr ?? ""}`);
  const words = foldName(query).split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

/** The entries within `radius` m of a point, nearest first. */
export function nearby<T extends { x: number; y: number }>(
  entries: readonly T[],
  x: number,
  y: number,
  radius: number
): (T & { d: number })[] {
  return entries
    .map((e) => ({ ...e, d: Math.hypot(e.x - x, e.y - y) }))
    .filter((e) => e.d <= radius)
    .sort((a, b) => a.d - b.d);
}
