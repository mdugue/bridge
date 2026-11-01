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
  type CityObjectTable,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_SCAN,
  hasObjectFlag,
  type Rgb,
} from "./city-mesh";
import { decodeDrawn } from "./drawn-facts";
import {
  type CardCredits,
  type CardFact,
  factLines,
  germanDates,
  type InquiryCard,
  metres,
  osmSource,
  squareMetres,
  stated,
  whole,
} from "./card-lines";
import {
  bridgeCard,
  type FeatureInquiry,
  monumentCard,
  type TreeFacts,
  treeCard,
} from "./inquiry-features";
import { moreCard } from "./inquiry-more";
import type { Stated } from "./methods";
import { bikeCard, trafficCard } from "./inquiry-traffic";
import { designCard } from "./inquiry-design";
import {
  isMeasuredRoof,
  MEASURED_ROOF,
  MEASURED_SHAPE,
  NO_FACT,
  type ObjectFacts,
} from "./object-facts";
import { parseLod2Stand, type SiteProvenance } from "./provenance";
import type { WindowSpec } from "./windows";
import {
  factsFor,
  landmarkCardFacts,
  type LandmarkFactsIndex,
  wikidataSource,
} from "./landmark-facts";

export type { CardFact, InquiryCard } from "./card-lines";
export { germanDates, metres, squareMetres } from "./card-lines";

/** How an object is drawn: its row of the object table's style columns
 *  (lib/city/city-mesh.ts). */
export interface ObjectLook {
  /** a warm glow at dusk (commerce, public: its use) */
  glow: boolean;
  /** roof colour (linear RGB) */
  roof: Rgb;
  /** the storey the bands and windows keep (m) */
  storeyH: number;
  /** wall colour (linear RGB) */
  tint: Rgb;
  windows: WindowSpec;
}

/** An object's look from its tile's table. */
export function objectLook(table: CityObjectTable, i: number): ObjectLook {
  const rgb = (a: Float32Array): Rgb => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  return {
    glow: table.glow[i] === 1,
    roof: rgb(table.roof),
    storeyH: table.storeyH[i],
    tint: rgb(table.tint),
    windows: {
      axis: table.winAxis[i],
      h: table.winH[i],
      style: table.winStyle[i],
      w: table.winW[i],
    },
  };
}

/** One object of the asked building, as the scene read it. */
export interface InquiryObject {
  /** the Building itself (true) or one of its parts */
  building: boolean;
  /** eave height above the base (m) */
  eaveH: number;
  facts: ObjectFacts;
  /** OBJECT_FLAG_* bits (shop, heritage) */
  flags: number;
  /** the root of its tile's ensemble, which the bake gives that tile's
   *  whole ensemble's height and ground (lib/city/ensembles.ts) */
  lead?: boolean;
  /** how it is drawn (absent where the scene did not say) */
  look?: ObjectLook;
  objectIndex: number;
  /** OBJECT_SOURCE_* (LoD2 or the laser scan) */
  source: number;
}

/** What the scene hands the card for a building: the picked object and
 *  its whole tree — or its ensemble's trees, where the survey's Buildings
 *  are one building to a visitor (lib/city/ensembles.ts). */
export interface BuildingInquiry {
  /** where it was asked, in the site's CRS (easting, northing) */
  at?: [number, number];
  kind: "building";
  picked: InquiryObject;
  /** every object of the picked object's building tree (its ensemble's
   *  trees, in every tile it stands in), the picked one too */
  tree: InquiryObject[];
  tile: string;
  /** the site's landmark facts file (Wikidata), set where the building is
   *  a landmark: the card lists what the nameplate says under its name */
  landmarkFactsUrl?: string;
}

/** Whatever someone asked about (ADR 0042, plan 052 phase 4). */
export type Inquiry = BuildingInquiry | FeatureInquiry;

/**
 * What else a question's ray met (the HUD's strip of candidates): every
 * thing on it and within a finger's width, nearest first, each with its
 * inquiry, and which one the card shows.
 */
export interface InquiryAlong {
  /** where it was asked (NDC), null at the centre */
  at: { x: number; y: number } | null;
  candidates: { distance: number; inquiry: Inquiry; key: string }[];
  selected: number;
}

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
  if (code === MEASURED_SHAPE) {
    return "geformt wie gemessen";
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
  credits: CardCredits,
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
  parts.push(source?.credit ?? credits.provider);
  return parts.join(" · ");
}

/** The surface model's line for a roof rebuilt from it (ADR 0036). */
function rebuiltSource(
  provenance: SiteProvenance | null,
  credits: CardCredits,
  tile: string
): string {
  const source = provenance?.sources.dom;
  const stand = provenance?.tiles[tile]?.dom;
  return [
    `Dach und Höhe: ${source?.label ?? "Digitales Oberflächenmodell DOM1"}`,
    stand ? `Befliegung ${germanDates(stand)}` : "",
    "das Stadtmodell verfehlt dieses Dach",
    source?.credit ?? credits.provider,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The laser scan's source line (a structure LoD2 lacks, plan 034). */
function scanSource(
  provenance: SiteProvenance | null,
  credits: CardCredits,
  tile: string
): string {
  const source = provenance?.sources.lsc;
  const stand = provenance?.tiles[tile]?.lsc;
  return [
    source?.label ?? "Laserscan",
    stand ? `Befliegung ${germanDates(stand)}` : "",
    "nicht im amtlichen Stadtmodell",
    source?.credit ?? credits.provider,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The surface model's line for a building LoD2 lacks
 *  (pipeline/bake/structures.py): its height measured there, or — where
 *  OSM's height stands (`osmHeight`) — how we know the model predates it. */
function gapSource(
  provenance: SiteProvenance | null,
  credits: CardCredits,
  tile: string,
  osmHeight: boolean
): string {
  const source = provenance?.sources.dom;
  const stand = provenance?.tiles[tile]?.dom;
  const label = source?.label ?? "Digitales Oberflächenmodell DOM1";
  return [
    osmHeight ? label : `Höhe: ${label}`,
    stand ? `Befliegung ${germanDates(stand)}` : "",
    osmHeight
      ? "beflogen, bevor das Gebäude stand"
      : "nicht im amtlichen Stadtmodell",
    source?.credit ?? credits.provider,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The most addresses a card names: an ensemble (the World Trade Center)
 *  has a dozen. */
const MAX_ADDRESSES = 3;

/** The address line: the picked object's first, then the others, the rest
 *  counted. */
function addressLine(addresses: readonly string[]): string {
  const shown = addresses.slice(0, MAX_ADDRESSES).join(" · ");
  const more = addresses.length - MAX_ADDRESSES;
  return more > 0 ? `${shown} und ${whole.format(more)} weitere` : shown;
}

/**
 * The facts of a building tree, merged: the picked part's roof; height and
 * ground from the Building itself, which the bake gives its whole tree's
 * (the union of the footprints, base to top: lib/city/object-facts.ts
 * `treeFacts`), else the highest part and the parts' sum.
 */
/** Buildings by their `gml:id`, each once (one without an id stays). */
function once(buildings: readonly InquiryObject[]): InquiryObject[] {
  const seen = new Set<string>();
  return buildings.filter((o) => {
    const id = o.facts.buildingId;
    if (!id) {
      return true;
    }
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function mergedFacts(inquiry: BuildingInquiry) {
  const all = inquiry.tree.length > 0 ? inquiry.tree : [inquiry.picked];
  const facts = all.map((o) => o.facts);
  const pick = inquiry.picked.facts;
  // the ensemble's leads, one a tile (a tile edge cuts a building in
  // two), else the picked tree's Building; a Building both tiles carry
  // whole counts once
  const leads = once(all.filter((o) => o.lead && o.building)).map(
    (o) => o.facts
  );
  const mine = all.find(
    (o) => o.building && o.facts.buildingId === pick.buildingId
  )?.facts;
  const building = leads.length > 0 ? leads : mine ? [mine] : [];
  const names = distinct([pick.name, ...facts.map((f) => f.name)]);
  const heights = known(facts.map((f) => f.height));
  const areas = known(facts.map((f) => f.area));
  const levels = known(facts.map((f) => f.levels));
  // the leads' own values: the highest, and their grounds summed (a tile
  // edge does not cut a footprint twice)
  const leadHeight = Math.max(0, ...known(building.map((f) => f.height)));
  const leadArea = known(building.map((f) => f.area)).reduce(
    (s, a) => s + a,
    0
  );
  const flags = all.reduce((sum, o) => sum | o.flags, 0);
  return {
    address: addressLine(distinct([pick.addr, ...facts.map((f) => f.addr)])),
    created: pick.created || distinct(facts.map((f) => f.created))[0] || "",
    functionCode:
      pick.function || distinct(facts.map((f) => f.function))[0] || "",
    height: leadHeight || (heights.length > 0 ? Math.max(...heights) : NO_FACT),
    area: leadArea || areas.reduce((s, a) => s + a, 0),
    levels: levels.length > 0 ? Math.max(...levels) : NO_FACT,
    name: names[0] ?? "",
    parts: all.filter((o) => !o.building).length,
    buildings: once(all.filter((o) => o.building)).length,
    heritage: hasObjectFlag(flags, OBJECT_FLAG_HERITAGE),
    rebuilt: facts.some((f) => isMeasuredRoof(f.roofType)),
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
    [
      "Dach",
      roofLabel(pick.facts.roofType, pick.facts.roofPitch),
      // roofs.py rebuilt it where the model's roof misses the surface
      isMeasuredRoof(pick.facts.roofType) ? "detected" : undefined,
    ],
    ["Grundfläche", t.area > 0 ? squareMetres(t.area) : ""],
    ["Geschosse", known(t.levels) ? whole.format(t.levels) : ""],
    [
      "Gebäude",
      t.buildings > 1 ? `${whole.format(t.buildings)} im Stadtmodell` : "",
      "detected",
    ],
    ["Gebäudeteile", t.parts > 1 ? whole.format(t.parts) : ""],
    ["Denkmal", t.heritage ? "Kulturdenkmal" : ""],
    // a shop point matched to the footprint (osm_buildings.py)
    ["Erdgeschoss", t.shop ? "Laden oder Gastronomie" : "", "detected"],
  ]);
}

/**
 * The card for one inquiry; `provenance` null until the manifest arrived
 * (the site's own `credits` stand in for its credit lines), `treeFacts`
 * until a tree's tile's facts file has (lib/city/inquiry-features.ts).
 */
export function inquiryCard(
  inquiry: Inquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits,
  treeFacts: TreeFacts | null = null,
  landmarks: LandmarkFactsIndex | null = null
): InquiryCard {
  switch (inquiry.kind) {
    case "building":
      return withLandmarkFacts(
        buildingCard(inquiry, provenance, credits),
        inquiry,
        landmarks
      );
    case "tree":
      return treeCard(inquiry, treeFacts, provenance, credits);
    case "monument":
      return monumentCard(inquiry, provenance, credits);
    case "bridge":
      return bridgeCard(inquiry, provenance, credits);
    case "traffic":
      return trafficCard(inquiry);
    case "bikes":
      return bikeCard(inquiry);
    case "design":
      return designCard(inquiry);
    case "canopy":
    case "furniture":
    case "hedge":
    case "lamp":
    case "landing":
    case "stop":
      return moreCard(inquiry, provenance, credits);
  }
}

/** A landmark's card with its Wikidata facts (the nameplate's lines) as
 *  rows and Wikidata as their source; the card as it was without any. */
function withLandmarkFacts(
  card: InquiryCard,
  inquiry: BuildingInquiry,
  landmarks: LandmarkFactsIndex | null
): InquiryCard {
  const buildings = [...new Set(inquiry.tree.map((o) => o.facts.buildingId))];
  const entry = landmarks ? factsFor(landmarks, buildings, card.title) : null;
  const rows = entry ? landmarkCardFacts(entry) : [];
  if (!entry || rows.length === 0) {
    return card;
  }
  return {
    ...card,
    facts: [...card.facts, ...rows],
    sources: [
      ...card.sources,
      ...stated(
        "taken",
        wikidataSource(
          rows.map((r) => r.label),
          entry.id
        )
      ),
    ],
  };
}

/** Where a building's card says it came from first: the city model, the
 *  laser scan (a small structure LoD2 lacks), or for a building LoD2 lacks
 *  the surface model — its height measured there, or flown before it stood
 *  where OSM's height stands (its OSM line names the height). */
function buildingSources(
  inquiry: BuildingInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits,
  o: {
    gap: boolean;
    osmHeight: boolean;
    scan: boolean;
    t: { created: string; rebuilt: boolean };
  }
): Stated[] {
  if (o.scan) {
    // small_buildings.py: found where the scan stands above the ground
    return stated("detected", scanSource(provenance, credits, inquiry.tile));
  }
  if (o.gap) {
    return stated(
      "detected",
      gapSource(provenance, credits, inquiry.tile, o.osmHeight)
    );
  }
  return stated(
    "taken",
    lod2Source(provenance, credits, inquiry.tile, o.t.created, o.t.rebuilt)
  );
}

/** A building's card (LoD2, or a scan structure LoD2 lacks). */
function buildingCard(
  inquiry: BuildingInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const pick = inquiry.picked;
  const scan = pick.source === OBJECT_SOURCE_SCAN;
  // structures.py: OSM's outline LoD2 lacks, its height the surface
  // model's, or OSM's where the model was flown before it stood
  const gap = pick.source === OBJECT_SOURCE_GAP;
  const osmHeight = gap && decodeDrawn(pick.facts.drawn).height === "osm";
  const t = mergedFacts(inquiry);
  const use = functionLabel(t.functionCode);
  const kind = scan ? "Kleinbau" : "Gebäude";
  const title = t.name || use || kind;
  const kicker = t.name && use ? use : kind;

  const facts = cardFacts(t, pick, scan || gap, use);
  const fromOsm = [
    gap ? "Umriss" : "",
    osmHeight ? "Höhe" : "",
    t.name ? "Name" : "",
    t.address ? "Adresse" : "",
    t.levels !== NO_FACT ? "Geschosse" : "",
    t.heritage ? "Denkmal" : "",
  ].filter(Boolean);
  const sources: Stated[] = buildingSources(inquiry, provenance, credits, {
    gap,
    osmHeight,
    scan,
    t,
  });
  if (t.rebuilt) {
    sources.push(
      ...stated("detected", rebuiltSource(provenance, credits, inquiry.tile))
    );
  }
  if (fromOsm.length > 0) {
    sources.push(
      ...stated("taken", osmSource(provenance, fromOsm, "buildings"))
    );
  }
  if (t.buildings > 1) {
    // ensembles.ts: one OSM name over touching Buildings
    sources.push(
      ...stated(
        "detected",
        osmSource(
          provenance,
          [`${whole.format(t.buildings)} Gebäude des Stadtmodells als ein Bau`],
          "buildings"
        )
      )
    );
  }
  if (t.shop) {
    sources.push(
      ...stated("detected", osmSource(provenance, ["Erdgeschoss"], "buildings"))
    );
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

/** The radius (CSS px) of the outer ring of rays around a tap. */
export const TOLERANCE_PX = 22;
