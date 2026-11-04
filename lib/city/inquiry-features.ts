/**
 * The inquiry cards of every thing that is not a building (plan 052 phase
 * 4, 4e): a tree of the city's register or OSM, a monument or fountain, a
 * bridge, and every other tree the scene draws (the surface model's
 * crowns, the laser scan's, the Basis-DLM's tree rows), the hedges, the
 * street lamps, the street furniture and playgrounds, the tram stops and
 * the landing stages on the river. Each says only what its data knows — a
 * size the register filled in from the tile's statistics is no fact, most
 * of a street thing is OSM's position and kind — and quotes each source it
 * used. The building's card is lib/city/inquiry.ts. No THREE, no DOM.
 */
import type {
  BridgeFeature,
  FurnitureFeature,
  FurnitureKind,
  LampHeightSource,
  LowVegSource,
  MonumentFeature,
  RiversideFeature,
  TreeFactsFile,
} from "./features";
import {
  factLines,
  firstText,
  germanDates,
  mapillarySource,
  metres,
  osmSource,
  positionKey,
  sourceLine,
  stated,
  whole,
} from "./card-lines";
import type {
  CardCredits,
  CardFact,
  CardHeading,
  InquiryCard,
} from "./card-lines";
import type { DesignInquiry } from "./inquiry-design";
import type { Stated } from "./methods";
import type { BikeInquiry, TrafficInquiry } from "./inquiry-traffic";
import type { SiteProvenance } from "./provenance";

type Props<F extends { properties: unknown }> = NonNullable<F["properties"]>;

/** A tree someone asked about: its feature and, once fetched, its facts. */
export interface TreeInquiry {
  /** conifer by its archetype (no species known: the kind of tree) */
  conifer: boolean;
  /** drawn as the cone (its archetype's crown, tree-inventory.ts
   *  ARCHETYPE_SHAPE): outlined as one — a pine or a yew is not */
  cone?: boolean;
  /** the genus the bake keyed its season on ("" none) */
  genus: string;
  /** the tile's facts file (ADR 0042), fetched with the question */
  factsUrl?: string;
  /** its index in the tile's trees file */
  index: number;
  kind: "tree";
  /** from OSM, not the city's register */
  osm: boolean;
  /** an orchard tree (OSM's orchards, lib/city/cultivated.ts): no row of
   *  the facts file, no register */
  orchard?: boolean;
  /** an orchard tree DOM1 measured: its height and crown are facts */
  measured?: boolean;
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
  | DesignInquiry
  | MonumentInquiry
  | MoreInquiry
  | TrafficInquiry
  | TreeInquiry;

const KNOWN_HEIGHT = 1;
const KNOWN_CROWN = 2;
const KNOWN_TRUNK = 4;

/** The street-tree register's name where the manifest has none. */
const REGISTER_LABEL = "Stadtbaumkataster";

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

/** An orchard tree's heading: its genus. */
function orchardHeading(t: TreeInquiry): CardHeading {
  return { kicker: "Obstbaum", title: firstText(t.genus, "Obstbaum") };
}

/** An orchard tree's card: the orchard from OSM; where DOM1 measured the
 *  tree (a crown peak, cultivated.py) its height and crown, else no fact
 *  (its size is the orchard's default). */
function orchardCard(
  t: TreeInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const measured = t.measured === true;
  return {
    ...orchardHeading(t),
    address: "",
    facts: measured
      ? factLines([
          ["Höhe", metres(t.height)],
          ["Krone", `Ø ${metres(t.crown)}`],
        ])
      : [],
    id: positionKey(t.position),
    idLabel: "Lage",
    sources: [
      ...stated("taken", osmSource(provenance, ["Obstwiese"], "trees")),
      ...(measured
        ? stated(
            "detected",
            sourceLine(
              provenance,
              "dom",
              ["Standort, Höhe und Krone gemessen"],
              {
                label: "Digitales Oberflächenmodell DOM1",
                credit: credits.provider,
              },
              ""
            )
          )
        : []),
    ],
  };
}

/** The register that names a tree: none for OSM's (provenance.ts
 *  treesSource), nor for a site without one. */
const registerOf = (t: TreeInquiry, credits: CardCredits) =>
  t.osm ? undefined : credits.register;

/** A tree's heading: its species, else its genus, else its kind; a
 *  register's tree is a "Stadtbaum". */
export function treeHeading(
  t: TreeInquiry,
  facts: TreeFacts | null,
  credits: CardCredits
): CardHeading {
  if (t.orchard) {
    return orchardHeading(t);
  }
  const f = facts ?? NO_TREE_FACTS;
  return {
    kicker: registerOf(t, credits) === undefined ? "Baum" : "Stadtbaum",
    title: firstText(
      f.german,
      f.botanical,
      t.genus,
      t.conifer ? "Nadelbaum" : "Laubbaum"
    ),
  };
}

/** The tree's card; `facts` null until its tile's file has arrived. */
export function treeCard(
  t: TreeInquiry,
  facts: TreeFacts | null,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  if (t.orchard) {
    return orchardCard(t, provenance, credits);
  }
  const f = facts ?? NO_TREE_FACTS;
  const heading = treeHeading(t, facts, credits);
  const what = [
    firstText(f.german, f.botanical) ? "Art" : "",
    f.known & (KNOWN_HEIGHT | KNOWN_CROWN | KNOWN_TRUNK) ? "Maße" : "",
  ].filter(Boolean);
  // a site without a register has OSM's trees alone (provenance.ts
  // treesSource): no register is named, nor the provider credited for one
  const register = registerOf(t, credits);
  const source =
    register === undefined
      ? osmSource(provenance, what.length > 0 ? what : ["Baum"], "trees")
      : sourceLine(provenance, "trees", what, {
          label: REGISTER_LABEL,
          credit: register,
        });
  const nr = f.nr > 0 ? ` · Baum Nr. ${whole.format(f.nr)}` : "";
  return {
    ...heading,
    address: f.place ? `${f.place}${nr}` : "",
    facts: treeLines(t, f, heading.title),
    id: positionKey(t.position),
    idLabel: "Lage",
    sources: stated("taken", source),
  };
}

const MONUMENT_KIND: Record<Props<MonumentFeature>["kind"], string> = {
  fountain: "Brunnen",
  statue: "Denkmal",
  stone: "Gedenkstein",
  column: "Säule",
};

/** The kicker of a monument whose form OSM names. */
const MONUMENT_FORM: Record<string, string> = {
  statue: "Standbild",
  bust: "Büste",
  sculpture: "Skulptur",
  stele: "Stele",
  stone: "Gedenkstein",
  obelisk: "Obelisk",
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

function monumentFacts(
  p: Props<MonumentFeature>,
  height: number | null
): CardFact[] {
  return factLines([
    [
      "Form",
      p.kind === "fountain" ? (FOUNTAIN_STYLE[p.style ?? ""] ?? "") : "",
    ],
    ["Skulptur", p.figure ? "im Becken" : ""],
    ["Werk von", p.artist ?? ""],
    ["Material", p.material ?? ""],
    ["Höhe", height ? metres(height) : ""],
  ]);
}

/** What OSM told of a monument, for its source line. */
function monumentOsmWhat(
  p: Props<MonumentFeature>,
  fromDlm: boolean,
  tagged: boolean
): string[] {
  if (p.kind === "fountain") {
    return [p.name && !fromDlm ? "Name, Becken" : "Becken"];
  }
  const what = [
    p.name && !fromDlm ? "Name" : "",
    p.form ? "Art" : "",
    p.artist ? "Werk" : "",
    p.material && !p.wikidata ? "Material" : "",
    tagged ? "Höhe" : "",
  ].filter(Boolean);
  return what.length > 0 ? what : ["Lage"];
}

/** The line of the surface a monument's height was measured in: the
 *  laser scan where it saw the monument (`hs`), else DOM1. */
function measuredSource(
  p: Props<MonumentFeature>,
  provenance: SiteProvenance | null,
  credits: CardCredits
): string {
  return p.hs === "lsc"
    ? sourceLine(
        provenance,
        "lsc",
        ["Höhe gemessen"],
        { label: "Laserscan", credit: credits.provider },
        ""
      )
    : sourceLine(
        provenance,
        "dom",
        ["Höhe gemessen"],
        {
          label: "Digitales Oberflächenmodell DOM1",
          credit: credits.provider,
        },
        ""
      );
}

/** A monument's heading: its name, under its form or kind. */
export function monumentHeading(m: MonumentInquiry): CardHeading {
  const p = m.properties;
  const kicker =
    MONUMENT_FORM[p.form ?? ""] ?? MONUMENT_KIND[p.kind] ?? "Denkmal";
  return { kicker, title: firstText(p.name, kicker) };
}

/** The monument's or fountain's card. */
export function monumentCard(
  m: MonumentInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const p = m.properties;
  // its measured form's top, else a tagged height, else the height
  // measured in the open around its point (`hm`)
  const relief = reliefHeight(p);
  const tagged = relief ? undefined : p.height;
  const height = relief ?? tagged ?? p.hm ?? null;
  const measured = height !== null && tagged === undefined;
  const facts = monumentFacts(p, height);
  const fromDlm = p.source === "dlm" || p.source === "dlm+osm";
  const fromOsm = p.source === "osm" || p.source === "dlm+osm";
  const osmWhat = monumentOsmWhat(p, fromDlm, tagged !== undefined);
  const sources = [
    ...stated(
      "taken",
      fromDlm
        ? sourceLine(provenance, "dlm", [p.name ? "Name" : "Lage"], {
            label: "Basis-DLM",
            credit: credits.provider,
          })
        : "",
      fromOsm ? osmSource(provenance, osmWhat, "fountains") : "",
      p.wikidata
        ? sourceLine(provenance, "wikidata", ["Material"], {
            label: "Wikidata",
            credit: "CC0",
          })
        : ""
    ),
    ...stated(
      "computed",
      measured ? measuredSource(p, provenance, credits) : ""
    ),
  ];
  return {
    ...monumentHeading(m),
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

/**
 * Where a bridge's area and deck come from: the provider's Basis-DLM, the
 * deck measured in its DOM1 — or, where the provider has no Basis-DLM
 * (Hamburg, Berlin: rail_osm.py), OSM's bridge ways, the deck still
 * measured in the provider's DOM1.
 */
function bridgeAreaLines(
  area: string,
  provenance: SiteProvenance | null,
  credits: CardCredits
): Stated[] {
  const deck = "Deck im DOM1 gemessen";
  if (credits.dlm) {
    return stated(
      "taken",
      sourceLine(provenance, "dlm", [area], {
        label: "Basis-DLM",
        credit: credits.provider,
      })
    ).concat(
      // bridge.py: the deck line, the surface's lower third across it
      stated(
        "computed",
        sourceLine(
          provenance,
          "dom",
          [deck],
          {
            label: "Digitales Oberflächenmodell DOM1",
            credit: credits.provider,
          },
          ""
        )
      )
    );
  }
  return [
    ...stated("taken", osmSource(provenance, [area], "bridges")),
    ...stated(
      "computed",
      sourceLine(
        provenance,
        "dom",
        [deck],
        { label: "Digitales Oberflächenmodell DOM1", credit: credits.provider },
        ""
      )
    ),
  ];
}

/** A bridge's heading: its name, under its kind. */
export function bridgeHeading(b: BridgeInquiry): CardHeading {
  const kicker = BRIDGE_KIND[b.properties.kind ?? "other"] ?? "Brücke";
  return { kicker, title: firstText(b.properties.name, kicker) };
}

/** The bridge's card. */
export function bridgeCard(
  b: BridgeInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const p = b.properties;
  const structure = structureLabel(p.structure);
  const facts = factLines([
    ["Tragwerk", structure],
    ["Länge", b.length > 0 ? metres(b.length) : ""],
    ["Hauptspannweite", p.span ? metres(p.span) : ""],
    ["Durchfahrtshöhe", p.clearance ? metres(p.clearance) : ""],
  ]);
  const sources = [
    ...bridgeAreaLines(p.name ? "Name, Fläche" : "Fläche", provenance, credits),
    ...stated(
      "taken",
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
      p.clearance ? osmSource(provenance, ["Durchfahrtshöhe"], "bridges") : ""
    ),
  ];
  return {
    ...bridgeHeading(b),
    address: "",
    facts,
    id: p.wikidata ?? positionKey(b.position),
    idLabel: p.wikidata ? "Wikidata" : "Lage",
    sources,
  };
}

/** A tree the scene draws that no register names: a crown the surface
 *  model (DOM1) or the laser scan measured, or a tree of a Basis-DLM row. */
export interface CanopyInquiry {
  /** drawn as the cone (an evergreen that is not a pine): outlined as one */
  cone?: boolean;
  /** the crown's measured diameter (m; the laser scan's) */
  crown?: number;
  /** an evergreen, and what told it: the forest's kind (a needle forest)
   *  or the leaf-off orthophoto (green in a mixed forest) */
  evergreen?: "forest" | "photo";
  /** the measured height (m; DOM1 − DGM1 or the laser scan) */
  height?: number;
  kind: "canopy";
  position: [number, number];
  source: "dom" | "lsc" | "row";
  tile: string;
}

/** A hedge: OSM's line at its laser-scan height, or a Basis-DLM row. */
export interface HedgeInquiry {
  height?: number;
  kind: "hedge";
  /** its length on the tile (m) */
  length: number;
  position: [number, number];
  source: LowVegSource | "dlm";
  tile: string;
  width?: number;
}

/** A street lamp (OSM, or Mapillary's: `src`). */
export interface LampInquiry {
  /** a tall mast's head on an arm over the carriageway
   *  (pipeline/bake/lamp_heights.py `arm_of`) */
  arm?: boolean;
  /** the post's height (m) where DOM1 measured it, and how: its street's
   *  median, or its kind of street's (pipeline/bake/lamp_heights.py); a
   *  wall lantern's assumed head height (pipeline/bake/lamps.py WALL_H) */
  height?: number;
  heightFrom?: LampHeightSource;
  /** hung on a wire across the street (pipeline/bake/lamps.py) */
  hung?: boolean;
  kind: "lamp";
  position: [number, number];
  src?: "mly";
  tile: string;
  /** on its bracket, where OSM puts it on a wall: out of a building's
   *  facade, or — no building near — out of a mapped wall */
  wall?: "facade" | "wall";
}

/** A piece of street furniture or a playground (OSM). */
export interface FurnitureInquiry {
  kind: "furniture";
  position: [number, number];
  properties: NonNullable<FurnitureFeature["properties"]>;
  tile: string;
}

/** A tram stop (OSM): its name. */
export interface StopInquiry {
  kind: "stop";
  name: string;
  position: [number, number];
  tile: string;
}

/** A landing stage or pontoon on the river (OSM). */
export interface LandingInquiry {
  kind: "landing";
  position: [number, number];
  properties: NonNullable<RiversideFeature["properties"]>;
  tile: string;
}

export type MoreInquiry =
  | CanopyInquiry
  | FurnitureInquiry
  | HedgeInquiry
  | LampInquiry
  | LandingInquiry
  | StopInquiry;

const DOM_LABEL = "Digitales Oberflächenmodell DOM1";

/** A vegetation row's or a forest's source: the Basis-DLM's, or where the
 *  provider has none (Hamburg, Berlin: landcover_osm.py) OSM's hedges, tree
 *  rows and woods. */
function rowSource(
  what: string,
  provenance: SiteProvenance | null,
  credits: CardCredits
): Stated[] {
  return stated(
    "taken",
    credits.dlm
      ? sourceLine(provenance, "dlm", [what], {
          label: "Basis-DLM",
          credit: credits.provider,
        })
      : osmSource(provenance, [what], "trees")
  );
}

/** A thing's one source: Mapillary's detection in street photos, or OSM's
 *  mapped point. */
function pointSource(
  what: string,
  mapillary: boolean,
  provenance: SiteProvenance | null
): Stated[] {
  return mapillary
    ? stated("detected", mapillarySource([what]))
    : stated("taken", osmSource(provenance, [what], "trees"));
}

/** What a canopy card says for its species: DOP saw a crown, no register
 *  names it. */
export const UNKNOWN_SPECIES = "nicht bekannt";

/** A canopy tree's heading: a tree, of a row or not. */
export function canopyHeading(t: CanopyInquiry): CardHeading {
  return {
    kicker: t.source === "row" ? "Baum einer Baumreihe" : "Baum",
    title: "Baum",
  };
}

/** A tree the scene draws without a register's name. */
export function canopyCard(
  t: CanopyInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const facts = factLines([
    ["Höhe", t.height ? `${metres(t.height)}, gemessen` : ""],
    ["Krone", t.crown ? `Ø ${metres(t.crown)}, gemessen` : ""],
    ["Laub", t.evergreen ? "Nadelbaum, immergrün" : ""],
    ["Art", UNKNOWN_SPECIES],
  ]);
  const leaf = {
    forest: rowSource("Nadelwald", provenance, credits),
    photo: stated(
      "detected",
      sourceLine(provenance, "dop", ["grün im laubfreien Luftbild"], {
        label: "Digitales Orthophoto",
        credit: credits.provider,
      })
    ),
  };
  // a line carries the least certain of what it gives: the place of a
  // crown is detected (canopy.py, lowveg.py), its height then computed
  const sources = {
    dom: stated(
      "detected",
      sourceLine(provenance, "dom", ["Lage und Höhe der Krone"], {
        label: DOM_LABEL,
        credit: credits.provider,
      })
    ),
    lsc: stated(
      "detected",
      sourceLine(provenance, "lsc", ["Lage, Höhe und Krone"], {
        label: "Laserscan",
        credit: credits.provider,
      })
    ),
    row: rowSource("Baumreihe", provenance, credits),
  };
  const found = {
    dom: "Eine Krone, im Oberflächenmodell erkannt",
    lsc: "Eine Krone, im Laserscan erkannt",
    row: "Die Bäume einer Reihe stehen in festem Abstand, wie gezeichnet",
  };
  return {
    ...canopyHeading(t),
    address: found[t.source],
    facts,
    id: positionKey(t.position),
    idLabel: "Lage",
    sources: [...sources[t.source], ...(t.evergreen ? leaf[t.evergreen] : [])],
  };
}

/** Which survey measured a hedge's height, by its source: the laser scan
 *  or the surface model DOM1 (lowveg.py); none for the others. */
const HEDGE_MEASURED: Partial<Record<HedgeInquiry["source"], "dom" | "lsc">> = {
  "osm+lsc": "lsc",
  "osm+dom": "dom",
  lsc: "lsc",
};

/** A hedge's source lines: the Basis-DLM's row, the laser scan's own
 *  find, or OSM's line with the survey that measured its height. */
function hedgeSources(
  h: HedgeInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): Stated[] {
  if (h.source === "dlm") {
    return rowSource("Hecke", provenance, credits);
  }
  const scan = { label: "Laserscan", credit: credits.provider };
  if (h.source === "lsc") {
    return stated(
      "detected",
      sourceLine(provenance, "lsc", ["Verlauf und Höhe der Hecke"], scan)
    );
  }
  const by = HEDGE_MEASURED[h.source];
  const dom = { label: DOM_LABEL, credit: credits.provider };
  return [
    ...stated("taken", osmSource(provenance, ["Hecke"], "trees")),
    ...stated(
      "computed",
      by
        ? sourceLine(
            provenance,
            by,
            ["Höhe gemessen"],
            by === "lsc" ? scan : dom
          )
        : ""
    ),
  ];
}

/** A hedge's heading. */
export const HEDGE_HEADING: CardHeading = { kicker: "Hecke", title: "Hecke" };

/** A hedge. */
export function hedgeCard(
  h: HedgeInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const measured = HEDGE_MEASURED[h.source] !== undefined;
  const facts = factLines([
    [
      "Höhe",
      h.height ? `${metres(h.height)}${measured ? ", gemessen" : ""}` : "",
      measured ? undefined : "assumed",
    ],
    ["Breite", h.width ? metres(h.width) : ""],
    ["Länge", h.length > 0 ? metres(h.length) : ""],
  ]);
  const sources = hedgeSources(h, provenance, credits);
  return {
    ...HEDGE_HEADING,
    address: "",
    facts,
    id: positionKey(h.position),
    idLabel: "Lage",
    sources,
  };
}

/** A lamp's heading: a wall lantern, a lamp hung on a wire, or a post. */
export function lampHeading(l: LampInquiry): CardHeading {
  let title = "Straßenlaterne";
  if (l.wall) {
    title = "Wandleuchte";
  } else if (l.hung) {
    title = "Hängeleuchte";
  }
  return { kicker: "Straßenbeleuchtung", title };
}

/** A lantern on a facade: OSM says where it hangs, its height is assumed. */
function wallLampCard(
  l: LampInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  return {
    ...lampHeading(l),
    address: "",
    facts: factLines([
      ["Aufhängung", l.wall === "wall" ? "an der Mauer" : "an der Fassade"],
      ["Höhe", l.height ? `${metres(l.height)}, angenommen` : "", "assumed"],
    ]),
    id: positionKey(l.position),
    idLabel: "Lage",
    sources: pointSource("Laterne", l.src === "mly", provenance),
  };
}

/** A street lamp. */
export function lampCard(
  l: LampInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  if (l.wall) {
    return wallLampCard(l, provenance);
  }
  const measured = !l.hung && l.height !== undefined && l.heightFrom;
  const along = {
    street: "wie an den Laternen der Straße gemessen",
    class: "wie an den Laternen dieser Art Straße gemessen",
  };
  return {
    ...lampHeading(l),
    address: "",
    facts: factLines(
      l.hung
        ? [
            ["Aufhängung", "Querseil über der Straße", "computed"],
            ["Höhe", "7 m, angenommen", "assumed"],
          ]
        : [
            measured
              ? [
                  "Mast",
                  `${metres(l.height ?? 0)}, ${along[measured]}`,
                  "computed",
                ]
              : ["Mast", "5 m, angenommen", "assumed"],
            ["Ausleger", l.arm ? "zur Fahrbahn, angenommen" : "", "assumed"],
          ]
    ),
    id: positionKey(l.position),
    idLabel: "Lage",
    sources: [
      ...pointSource("Laterne", l.src === "mly", provenance),
      ...(measured
        ? stated(
            "computed",
            sourceLine(provenance, "dom", ["Höhe der Masten"], {
              label: DOM_LABEL,
              credit: credits.provider,
            })
          )
        : []),
    ],
  };
}

/** Each kind of furniture in words: what it is, and its group. */
const FURNITURE: Record<FurnitureKind, [string, string]> = {
  bench: ["Bank", "Stadtmobiliar"],
  bike: ["Fahrradbügel", "Stadtmobiliar"],
  bin: ["Papierkorb", "Stadtmobiliar"],
  bollard: ["Poller", "Stadtmobiliar"],
  clock: ["Uhr", "Stadtmobiliar"],
  column: ["Litfaßsäule", "Stadtmobiliar"],
  hydrant: ["Hydrant", "Feuerwehr"],
  hydrantsign: ["Hydrantenschild", "Feuerwehr"],
  pedsignal: ["Fußgängerampel", "Verkehr"],
  picnic: ["Picknicktisch", "Stadtmobiliar"],
  postbox: ["Briefkasten", "Post"],
  shelter: ["Wartehäuschen", "Haltestelle"],
  signal: ["Ampel", "Verkehr"],
  stop: ["Haltestellenschild", "Haltestelle"],
  wallclock: ["Uhr an der Fassade", "Stadtmobiliar"],
  water: ["Trinkbrunnen", "Wasser"],
  climb: ["Klettergerüst", "Spielplatz"],
  playground: ["Spielplatz", "Spielplatz"],
  playhouse: ["Spielhaus", "Spielplatz"],
  roundabout: ["Karussell", "Spielplatz"],
  sandpit: ["Sandkasten", "Spielplatz"],
  seesaw: ["Wippe", "Spielplatz"],
  slide: ["Rutsche", "Spielplatz"],
  springy: ["Federwippe", "Spielplatz"],
  swing: ["Schaukel", "Spielplatz"],
};

/** A bearing in words: "nach Südwesten". */
function facing(a: number | undefined): string {
  if (a === undefined || !Number.isFinite(a)) {
    return "";
  }
  const names = [
    "Norden",
    "Nordosten",
    "Osten",
    "Südosten",
    "Süden",
    "Südwesten",
    "Westen",
    "Nordwesten",
  ];
  return `nach ${names[Math.round((((a % 360) + 360) % 360) / 45) % 8]}`;
}

/** A piece of furniture's heading: its name, under its group. */
export function furnitureHeading(f: FurnitureInquiry): CardHeading {
  const [title, kicker] = FURNITURE[f.properties.k] ?? [
    "Stadtmobiliar",
    "Stadtmobiliar",
  ];
  return { kicker, title };
}

/** Whether a piece of furniture is a playground's. */
export function isPlay(f: FurnitureInquiry): boolean {
  return FURNITURE[f.properties.k]?.[1] === "Spielplatz";
}

/** A piece of street furniture or a playground. */
export function furnitureCard(
  f: FurnitureInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const p = f.properties;
  const heading = furnitureHeading(f);
  const facts = factLines([
    ["Länge", p.l ? metres(p.l) : ""],
    ["Lehne", p.k === "bench" && p.back === false ? "ohne" : ""],
    ["Bügel", p.n && p.n > 1 ? whole.format(p.n) : ""],
    ["Höhe", p.h ? metres(p.h) : ""],
    ["Material", p.metal ? "Metall" : ""],
    ["Beleuchtet", p.lit ? "ja" : ""],
    ["Ausleger", p.arm ? "über die Fahrbahn" : ""],
    ["Ausrichtung", p.k === "bench" || p.k === "shelter" ? facing(p.a) : ""],
  ]);
  return {
    ...heading,
    address: "",
    facts,
    id: positionKey(f.position),
    idLabel: "Lage",
    // a playground's piece OSM does not map: found in the surface model
    sources:
      p.src === "dom"
        ? stated(
            "computed",
            sourceLine(provenance, "dom", ["Lage und Höhe gemessen"], {
              label: DOM_LABEL,
              credit: "",
            })
          )
        : pointSource(heading.title, p.src === "mly", provenance),
  };
}

/** A tram stop's heading: its name. */
export function stopHeading(s: StopInquiry): CardHeading {
  return { kicker: "Straßenbahnhaltestelle", title: s.name || "Haltestelle" };
}

/** A tram stop. */
export function stopCard(
  s: StopInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  return {
    ...stopHeading(s),
    address: "",
    facts: [],
    id: positionKey(s.position),
    idLabel: "Lage",
    sources: stated("taken", osmSource(provenance, ["Name", "Lage"], "trees")),
  };
}

const LANDING: Record<string, string> = {
  pier: "Anlegestelle",
  pontoon: "Ponton",
  groyne: "Buhne",
  ferry: "Fähre",
};

const landingWord = (l: LandingInquiry) => LANDING[l.properties.k] ?? "Anleger";

/** A landing's heading: its name, else what it is. */
export function landingHeading(l: LandingInquiry): CardHeading {
  return {
    kicker: "Am Fluss",
    title: firstText(l.properties.name, landingWord(l)),
  };
}

/** A landing stage or pontoon. */
export function landingCard(
  l: LandingInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const p = l.properties;
  const title = landingWord(l);
  return {
    ...landingHeading(l),
    address: p.name ? title : "",
    facts: factLines([["Länge", p.len ? metres(p.len) : ""]]),
    id: positionKey(l.position),
    idLabel: "Lage",
    sources: stated("taken", osmSource(provenance, [title], "trees")),
  };
}
