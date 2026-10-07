/**
 * The inquiry cards of the things that are not buildings (plan 052 phase
 * 4): a tree of the city's register or OSM, a monument or fountain, a
 * bridge. Each says only what its data knows — a size the register filled
 * in from the tile's statistics is no fact — and quotes each source it
 * used. The building's card is lib/city/inquiry.ts. No THREE, no DOM.
 */
import type { BridgeFeature, MonumentFeature, TreeFactsFile } from "./features";
import {
  type CardFact,
  factLines,
  firstText,
  GEOSN_CREDIT,
  germanDates,
  type InquiryCard,
  metres,
  osmSource,
  positionKey,
  sourceLine,
  whole,
} from "./card-lines";
import type { MoreInquiry } from "./inquiry-more";
import type { BikeInquiry, TrafficInquiry } from "./inquiry-traffic";
import type { SiteProvenance } from "./provenance";

type Props<F extends { properties: unknown }> = NonNullable<F["properties"]>;

/** A tree someone asked about: its feature and, once fetched, its facts. */
export interface TreeInquiry {
  /** conifer by its archetype (no species known: the kind of tree) */
  conifer: boolean;
  /** the genus the bake keyed its season on ("" none) */
  genus: string;
  /** the tile's facts file (ADR 0042), fetched with the question */
  factsUrl?: string;
  /** its index in the tile's trees file */
  index: number;
  kind: "tree";
  /** from OSM, not the city's register */
  osm: boolean;
  /** where it stands (the site's CRS) */
  position: [number, number];
  tile: string;
  /** the trunk diameter the feature carries (cm), when it has one */
  trunk?: number;
  /** its height and crown as drawn (m) */
  height: number;
  crown: number;
}

/** One tree's row of the facts file. */
export interface TreeFacts {
  age: number;
  botanical: string;
  /** the register's last change of the record (ISO) */
  date: string;
  german: string;
  /** bit 1 height, 2 crown, 4 trunk measured */
  known: number;
  nr: number;
  place: string;
}

/** A tree's row of its tile's facts file (empty facts past its end). */
export function treeFactsAt(file: TreeFactsFile, index: number): TreeFacts {
  const at = <T>(table: readonly T[], column: readonly number[]) =>
    table[column[index] ?? -1];
  const [german, botanical] = at(file.names, file.name) ?? ["", ""];
  return {
    german,
    botanical,
    place: at(file.places, file.place) ?? "",
    nr: file.nr[index] ?? -1,
    age: file.age[index] ?? -1,
    date: at(file.dates, file.date) ?? "",
    known: file.known[index] ?? 0,
  };
}

export interface MonumentInquiry {
  kind: "monument";
  position: [number, number];
  properties: Props<MonumentFeature>;
  tile: string;
}

export interface BridgeInquiry {
  kind: "bridge";
  /** the deck's length along its axis (m) */
  length: number;
  position: [number, number];
  properties: Props<BridgeFeature>;
  tile: string;
}

export type FeatureInquiry =
  | BikeInquiry
  | BridgeInquiry
  | MonumentInquiry
  | MoreInquiry
  | TrafficInquiry
  | TreeInquiry;

const KNOWN_HEIGHT = 1;
const KNOWN_CROWN = 2;
const KNOWN_TRUNK = 4;

const REGISTER = {
  label: "Stadtbaumkataster",
  credit: "Landeshauptstadt Dresden, dl-de/by-2-0",
};

/** No facts yet: nothing measured, no species, no place. */
const NO_TREE_FACTS: TreeFacts = {
  age: -1,
  botanical: "",
  date: "",
  german: "",
  known: 0,
  nr: -1,
  place: "",
};

/** "16 Jahre (Eintrag vom 27.08.2025)" — the age as the register records
 *  it, on the day it was recorded. */
function ageLine(f: TreeFacts): string {
  if (f.age <= 0) {
    return "";
  }
  const when = f.date ? ` (Eintrag vom ${germanDates(f.date)})` : "";
  return `${whole.format(f.age)} Jahre${when}`;
}

/** The tree's lines: a size only where it is measured, not filled in. */
function treeLines(t: TreeInquiry, f: TreeFacts, title: string): CardFact[] {
  const species = firstText(f.german, f.botanical);
  return factLines([
    ["Art", f.german ? f.botanical : ""],
    ["Gattung", !species && t.genus !== title ? t.genus : ""],
    ["Höhe", f.known & KNOWN_HEIGHT ? metres(t.height) : ""],
    ["Krone", f.known & KNOWN_CROWN ? `Ø ${metres(t.crown)}` : ""],
    [
      "Stamm",
      f.known & KNOWN_TRUNK && t.trunk ? `Ø ${whole.format(t.trunk)} cm` : "",
    ],
    ["Alter", ageLine(f)],
  ]);
}

/** The tree's card; `facts` null until its tile's file has arrived. */
export function treeCard(
  t: TreeInquiry,
  facts: TreeFacts | null,
  provenance: SiteProvenance | null
): InquiryCard {
  const f = facts ?? NO_TREE_FACTS;
  const title = firstText(
    f.german,
    f.botanical,
    t.genus,
    t.conifer ? "Nadelbaum" : "Laubbaum"
  );
  const what = [
    firstText(f.german, f.botanical) ? "Art" : "",
    f.known & (KNOWN_HEIGHT | KNOWN_CROWN | KNOWN_TRUNK) ? "Maße" : "",
  ].filter(Boolean);
  const source = t.osm
    ? osmSource(provenance, what.length > 0 ? what : ["Baum"], "trees")
    : sourceLine(provenance, "trees", what, REGISTER);
  const nr = f.nr > 0 ? ` · Baum Nr. ${whole.format(f.nr)}` : "";
  return {
    kicker: t.osm ? "Baum" : "Stadtbaum",
    title,
    address: f.place ? `${f.place}${nr}` : "",
    facts: treeLines(t, f, title),
    id: positionKey(t.position),
    idLabel: "Lage",
    sources: [source],
  };
}

const MONUMENT_KIND: Record<Props<MonumentFeature>["kind"], string> = {
  fountain: "Brunnen",
  statue: "Denkmal",
  stone: "Gedenkstein",
  column: "Säule",
};

const FOUNTAIN_STYLE: Record<string, string> = {
  basin: "Becken mit Wasserspiel",
  pool: "stilles Becken",
  splash: "Wasserspiel im Pflaster",
};

/** The monument's measured height (m), when the bake measured its form. */
export function reliefHeight(p: Props<MonumentFeature>): number | null {
  const dm = p.relief?.dm;
  return dm && dm.length > 0 ? Math.max(...dm) / 10 : null;
}

/** The monument's or fountain's card. */
export function monumentCard(
  m: MonumentInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const p = m.properties;
  const kicker = MONUMENT_KIND[p.kind] ?? "Denkmal";
  const height = reliefHeight(p);
  const facts: CardFact[] = factLines([
    [
      "Form",
      p.kind === "fountain" ? (FOUNTAIN_STYLE[p.style ?? ""] ?? "") : "",
    ],
    ["Skulptur", p.figure ? "im Becken" : ""],
    ["Höhe", height ? metres(height) : ""],
  ]);
  const fromDlm = p.source === "dlm" || p.source === "dlm+osm";
  const fromOsm = p.source === "osm" || p.source === "dlm+osm";
  const sources = [
    fromDlm
      ? sourceLine(provenance, "dlm", [p.name ? "Name" : "Lage"], {
          label: "Basis-DLM",
          credit: GEOSN_CREDIT,
        })
      : "",
    fromOsm
      ? osmSource(
          provenance,
          [p.name && !fromDlm ? "Name, Becken" : "Becken"],
          "fountains"
        )
      : "",
    height
      ? sourceLine(
          provenance,
          "dom",
          ["Höhe gemessen"],
          {
            label: "Digitales Oberflächenmodell DOM1",
            credit: GEOSN_CREDIT,
          },
          ""
        )
      : "",
  ].filter(Boolean);
  return {
    kicker,
    title: firstText(p.name, kicker),
    address: "",
    facts,
    id: positionKey(m.position),
    idLabel: "Lage",
    sources,
  };
}

const BRIDGE_KIND: Record<string, string> = {
  road: "Straßenbrücke",
  rail: "Eisenbahnbrücke",
  path: "Wegbrücke",
  other: "Brücke",
};

const STRUCTURE: Record<string, string> = {
  arch: "Bogen",
  beam: "Balken",
  truss: "Fachwerk",
  suspension: "Hängebrücke",
  "cable-stayed": "Schrägseile",
  cantilever: "Kragträger",
  "simple-suspension": "Hängesteg",
  humpback: "Buckel",
  floating: "Schwimmbrücke",
};

/** OSM's bridge:structure ("beam;arch") in words ("Balken · Bogen"). */
export function structureLabel(structure: string | null | undefined): string {
  return (structure ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => STRUCTURE[s] ?? s)
    .join(" · ");
}

/** The bridge's card. */
export function bridgeCard(
  b: BridgeInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const p = b.properties;
  const kicker = BRIDGE_KIND[p.kind ?? "other"] ?? "Brücke";
  const structure = structureLabel(p.structure);
  const facts = factLines([
    ["Tragwerk", structure],
    ["Länge", b.length > 0 ? metres(b.length) : ""],
    ["Hauptspannweite", p.span ? metres(p.span) : ""],
    ["Durchfahrtshöhe", p.clearance ? metres(p.clearance) : ""],
  ]);
  const sources = [
    sourceLine(
      provenance,
      "dlm",
      [p.name ? "Name, Fläche" : "Fläche", "Deck im DOM1 gemessen"],
      { label: "Basis-DLM", credit: GEOSN_CREDIT }
    ),
    p.wikidata && (structure || p.span)
      ? sourceLine(
          provenance,
          "wikidata",
          [structure ? "Tragwerk" : "", p.span ? "Spannweite" : ""].filter(
            Boolean
          ),
          { label: "Wikidata", credit: "CC0" }
        )
      : "",
    !p.wikidata && structure
      ? osmSource(provenance, ["Tragwerk"], "bridges")
      : "",
    p.clearance ? osmSource(provenance, ["Durchfahrtshöhe"], "bridges") : "",
  ].filter(Boolean);
  return {
    kicker,
    title: firstText(p.name, kicker),
    address: "",
    facts,
    id: p.wikidata ?? positionKey(b.position),
    idLabel: p.wikidata ? "Wikidata" : "Lage",
    sources,
  };
}
