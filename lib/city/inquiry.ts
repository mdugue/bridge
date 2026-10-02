/**
 * The inquiry card: what the viewer says about a building when someone asks
 * (the "Befragen" mode, ADR 0042). The scene picks an object and hands over
 * its building tree's facts (lib/city/object-facts.ts); this module turns
 * them, with the provenance manifest, into the card's German lines — the
 * title, the facts, the identity and a source line for every fact shown.
 * Only measured or mapped facts appear, never an estimate: a building
 * without a mapped storey count has no storey line. No THREE, no DOM.
 */
import { BUILDING_FUNCTION, ROOF_TYPE } from "./adv-codes";
import {
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_SCAN,
  hasObjectFlag,
} from "./city-mesh";
import {
  type CardFact,
  factLines,
  GEOSN_CREDIT,
  germanDates,
  type InquiryCard,
  metres,
  osmSource,
  squareMetres,
  whole,
} from "./card-lines";
import {
  bridgeCard,
  type FeatureInquiry,
  monumentCard,
  type TreeFacts,
  treeCard,
} from "./inquiry-features";
import { bikeCard, trafficCard } from "./inquiry-traffic";
import { MEASURED_ROOF, NO_FACT, type ObjectFacts } from "./object-facts";
import { parseLod2Stand, type SiteProvenance } from "./provenance";

export type { CardFact, InquiryCard } from "./card-lines";
export { germanDates, metres, squareMetres } from "./card-lines";

/** One object of the asked building, as the scene read it. */
export interface InquiryObject {
  /** the Building itself (true) or one of its parts */
  building: boolean;
  /** eave height above the base (m) */
  eaveH: number;
  facts: ObjectFacts;
  /** OBJECT_FLAG_* bits (shop, heritage) */
  flags: number;
  objectIndex: number;
  /** OBJECT_SOURCE_* (LoD2 or the laser scan) */
  source: number;
}

/** What the scene hands the card for a building: the picked object and
 *  its whole tree. */
export interface BuildingInquiry {
  kind: "building";
  picked: InquiryObject;
  /** every object of the picked object's building tree, the picked one too */
  tree: InquiryObject[];
  tile: string;
}

/** Whatever someone asked about (ADR 0042, plan 052 phase 4). */
export type Inquiry = BuildingInquiry | FeatureInquiry;

/** The AdV code for "nach Quellenlage nicht zu spezifizieren". */
const UNSPECIFIED = "31001_9998";

/** A Gebäudefunktion as words; "" for none or the unspecified code. */
export function functionLabel(code: string): string {
  if (!code || code === UNSPECIFIED) {
    return "";
  }
  return BUILDING_FUNCTION[code] ?? `Funktion ${code}`;
}

/** A Dachform with its pitch: "Satteldach, 38°". */
export function roofLabel(code: string, pitch: number): string {
  if (code === MEASURED_ROOF) {
    return "flach, gestuft (gemessen)";
  }
  const form = code ? (ROOF_TYPE[code] ?? `Dachform ${code}`) : "";
  const slope = pitch === NO_FACT ? "" : `${whole.format(pitch)}°`;
  return [form, slope].filter(Boolean).join(", ");
}

const distinct = (values: readonly string[]): string[] => [
  ...new Set(values.filter(Boolean)),
];
const known = (values: readonly number[]): number[] =>
  values.filter((v) => v !== NO_FACT);

/** The LoD2 source line: the model year, its inputs, the object's export. */
function lod2Source(
  provenance: SiteProvenance | null,
  tile: string,
  created: string,
  rebuilt: boolean
): string {
  const source = provenance?.sources.lod2;
  const stand = provenance?.tiles[tile]?.lod2;
  const parts = [source?.label ?? "3D-Stadtmodell LoD2"];
  if (stand) {
    const { model, inputs } = parseLod2Stand(stand);
    parts.push(`Modell ${model}`);
    // a rebuilt roof is the surface model's (its own line), not the LoD2's
    if (inputs.LSC && !rebuilt) {
      parts.push(`Dach gemessen ${inputs.LSC}`);
    }
    if (inputs["Basis-DLM"]) {
      parts.push(`Grundriss ${inputs["Basis-DLM"]}`);
    }
  }
  if (created) {
    parts.push(`Objekt exportiert ${germanDates(created)}`);
  }
  parts.push(source?.credit ?? GEOSN_CREDIT);
  return parts.join(" · ");
}

/** The surface model's line for a roof rebuilt from it (ADR 0036). */
function rebuiltSource(
  provenance: SiteProvenance | null,
  tile: string
): string {
  const source = provenance?.sources.dom;
  const stand = provenance?.tiles[tile]?.dom;
  return [
    `Dach und Höhe: ${source?.label ?? "Digitales Oberflächenmodell DOM1"}`,
    stand ? `Befliegung ${germanDates(stand)}` : "",
    "das Stadtmodell verfehlt dieses Dach",
    source?.credit ?? GEOSN_CREDIT,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The laser scan's source line (a structure LoD2 lacks, plan 034). */
function scanSource(provenance: SiteProvenance | null, tile: string): string {
  const source = provenance?.sources.lsc;
  const stand = provenance?.tiles[tile]?.lsc;
  return [
    source?.label ?? "Laserscan",
    stand ? `Befliegung ${germanDates(stand)}` : "",
    "nicht im amtlichen Stadtmodell",
    source?.credit ?? GEOSN_CREDIT,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The facts of a building tree, merged: the picked part's roof; height and
 * ground from the Building itself, which the bake gives its whole tree's
 * (the union of the footprints, base to top: lib/city/object-facts.ts
 * `treeFacts`), else the highest part and the parts' sum.
 */
function mergedFacts(inquiry: BuildingInquiry) {
  const all = inquiry.tree.length > 0 ? inquiry.tree : [inquiry.picked];
  const facts = all.map((o) => o.facts);
  const pick = inquiry.picked.facts;
  const building = all.find((o) => o.building)?.facts;
  const names = distinct([pick.name, ...facts.map((f) => f.name)]);
  const heights = known(facts.map((f) => f.height));
  const areas = known(facts.map((f) => f.area));
  const levels = known(facts.map((f) => f.levels));
  const own = (v: number | undefined) => (v !== undefined && v > 0 ? v : 0);
  const flags = all.reduce((sum, o) => sum | o.flags, 0);
  return {
    address: distinct([pick.addr, ...facts.map((f) => f.addr)]).join(" · "),
    created: pick.created || distinct(facts.map((f) => f.created))[0] || "",
    functionCode:
      pick.function || distinct(facts.map((f) => f.function))[0] || "",
    height:
      own(building?.height) ||
      (heights.length > 0 ? Math.max(...heights) : NO_FACT),
    area: own(building?.area) || areas.reduce((s, a) => s + a, 0),
    levels: levels.length > 0 ? Math.max(...levels) : NO_FACT,
    name: names[0] ?? "",
    parts: all.filter((o) => !o.building).length,
    heritage: hasObjectFlag(flags, OBJECT_FLAG_HERITAGE),
    rebuilt: facts.some((f) => f.roofType === MEASURED_ROOF),
    shop: hasObjectFlag(flags, OBJECT_FLAG_SHOP),
  };
}

/**
 * The fact lines in reading order; a line whose value is unknown is left
 * out. The use already stands in the title or the kicker, so only its
 * absence needs saying.
 */
function cardFacts(
  t: ReturnType<typeof mergedFacts>,
  pick: InquiryObject,
  scan: boolean,
  use: string
): CardFact[] {
  const known = (v: number) => v !== NO_FACT && v > 0;
  return factLines([
    ["Nutzung", scan || use ? "" : "nicht angegeben"],
    ["Höhe", known(t.height) ? metres(t.height) : ""],
    ["Traufe", !scan && pick.eaveH > 0 ? metres(pick.eaveH) : ""],
    ["Dach", roofLabel(pick.facts.roofType, pick.facts.roofPitch)],
    ["Grundfläche", t.area > 0 ? squareMetres(t.area) : ""],
    ["Geschosse", known(t.levels) ? whole.format(t.levels) : ""],
    ["Gebäudeteile", t.parts > 1 ? whole.format(t.parts) : ""],
    ["Denkmal", t.heritage ? "Kulturdenkmal" : ""],
    ["Erdgeschoss", t.shop ? "Laden oder Gastronomie" : ""],
  ]);
}

/**
 * The card for one inquiry; `provenance` null until the manifest arrived,
 * `treeFacts` until a tree's tile's facts file has (lib/city/inquiry-
 * features.ts).
 */
export function inquiryCard(
  inquiry: Inquiry,
  provenance: SiteProvenance | null,
  treeFacts: TreeFacts | null = null
): InquiryCard {
  switch (inquiry.kind) {
    case "building":
      return buildingCard(inquiry, provenance);
    case "tree":
      return treeCard(inquiry, treeFacts, provenance);
    case "monument":
      return monumentCard(inquiry, provenance);
    case "bridge":
      return bridgeCard(inquiry, provenance);
    case "traffic":
      return trafficCard(inquiry);
    case "bikes":
      return bikeCard(inquiry);
  }
}

/** A building's card (LoD2, or a scan structure LoD2 lacks). */
function buildingCard(
  inquiry: BuildingInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const pick = inquiry.picked;
  const scan = pick.source === OBJECT_SOURCE_SCAN;
  const t = mergedFacts(inquiry);
  const use = functionLabel(t.functionCode);
  const kind = scan ? "Kleinbau" : "Gebäude";
  const title = t.name || use || kind;
  const kicker = t.name && use ? use : kind;

  const facts = cardFacts(t, pick, scan, use);
  const fromOsm = [
    t.name ? "Name" : "",
    t.address ? "Adresse" : "",
    t.levels !== NO_FACT ? "Geschosse" : "",
    t.heritage ? "Denkmal" : "",
    t.shop ? "Erdgeschoss" : "",
  ].filter(Boolean);
  const sources = [
    scan
      ? scanSource(provenance, inquiry.tile)
      : lod2Source(provenance, inquiry.tile, t.created, t.rebuilt),
  ];
  if (t.rebuilt) {
    sources.push(rebuiltSource(provenance, inquiry.tile));
  }
  if (fromOsm.length > 0) {
    sources.push(osmSource(provenance, fromOsm, "buildings"));
  }
  return {
    kicker,
    title,
    address: t.address,
    facts,
    id: pick.facts.buildingId,
    idLabel: "Kennung",
    sources,
  };
}
