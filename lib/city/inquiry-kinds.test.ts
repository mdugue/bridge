/**
 * Every kind of thing the twin answers, routed: one fixture per kind (the
 * mapped type demands one for a new kind), the card `inquiryCard` gives it
 * against its own card function, and the heading the strip of candidates
 * shows. The words themselves are pinned by each card's own test file.
 */
import { describe, expect, test } from "bun:test";
import { cardCredits } from "./card-lines";
import type { InquiryCard } from "./card-lines";
import { OBJECT_SOURCE_LOD2 } from "./city-mesh";
import { inquiryCard, isPorous, kindLabel, thingKey } from "./inquiry";
import type { Inquiry, InquiryObject, KindIcon } from "./inquiry";
import { designCard } from "./inquiry-design";
import {
  bridgeCard,
  canopyCard,
  furnitureCard,
  hedgeCard,
  lampCard,
  landingCard,
  monumentCard,
  stopCard,
  treeCard,
} from "./inquiry-features";
import type { TreeFacts } from "./inquiry-features";
import { bikeCard, trafficCard } from "./inquiry-traffic";
import { NO_FACT } from "./object-facts";
import type { SiteProvenance } from "./provenance";

type Kind = Inquiry["kind"];
type Of<K extends Kind> = Extract<Inquiry, { kind: K }>;

const at: [number, number] = [411_000, 5_656_000];

const picked: InquiryObject = {
  building: true,
  eaveH: 12,
  facts: {
    buildingId: "DESNATPU1000HJx5",
    drawn: "",
    function: "31001_3041",
    roofType: "3100",
    created: "",
    name: "Dreikönigskirche",
    addr: "Hauptstraße 23",
    height: 24,
    roofPitch: 40,
    area: NO_FACT,
    levels: NO_FACT,
  },
  flags: 0,
  objectIndex: 0,
  source: OBJECT_SOURCE_LOD2,
};

/** One of each kind (the tree is a register's). */
const FIXTURES: { [K in Kind]: Of<K> } = {
  building: { kind: "building", tile: "t", picked, tree: [picked] },
  tree: {
    kind: "tree",
    tile: "t",
    index: 0,
    position: at,
    osm: false,
    conifer: false,
    genus: "Tilia",
    height: 6,
    crown: 2.4,
    trunk: 9,
  },
  monument: {
    kind: "monument",
    tile: "t",
    position: at,
    properties: {
      kind: "fountain",
      name: "Gänsedieb-Brunnen",
      source: "dlm+osm",
      style: "basin",
      figure: true,
    },
  },
  bridge: {
    kind: "bridge",
    tile: "t",
    length: 263.4,
    position: at,
    properties: { name: "Albertbrücke", kind: "road", structure: "arch" },
  },
  traffic: {
    kind: "traffic",
    tile: "t",
    index: 0,
    position: at,
    bearing: 110,
    properties: {
      t: 15_000,
      f: 9000,
      b: 6000,
      y: 2025,
      m: "detector",
      n: "Antonstraße",
    },
    credit: "Verkehrsmengen: Landeshauptstadt Dresden, dl-de/by-2-0",
  },
  bikes: {
    kind: "bikes",
    id: "100",
    name: "Albertbrücke",
    where: "in Höhe Rosa-Luxemburg-Platz",
    directions: [
      { count: 212, toward: "Neustadt" },
      { count: 180, toward: "Altstadt" },
    ],
    measuredAt: new Date(Date.UTC(2026, 9, 1, 12)),
    now: new Date(Date.UTC(2026, 9, 1, 13)),
    position: at,
    staleAfterMs: 3 * 3_600_000,
  },
  design: {
    kind: "design",
    file: "neubau.ifc",
    part: {
      name: "Außenwand Nord",
      type: "IfcWallStandardCase",
      id: "2O2Fr$t4X7Zf8NOew3FLOH",
      material: null,
    },
    partIndex: 3,
    placement: { east: 412_300, north: 5_657_420, base: 112.3, rotation: 15 },
    source: "file",
    triangles: 12_345,
    position: at,
  },
  canopy: {
    kind: "canopy",
    tile: "t",
    position: at,
    source: "dom",
    height: 17.4,
  },
  hedge: {
    kind: "hedge",
    tile: "t",
    position: at,
    length: 42,
    source: "osm+lsc",
    height: 2,
  },
  lamp: { kind: "lamp", tile: "t", position: at },
  furniture: {
    kind: "furniture",
    tile: "t",
    position: at,
    properties: { k: "bench", a: 225, back: false, l: 2 },
  },
  stop: { kind: "stop", tile: "t", position: at, name: "Albertplatz" },
  landing: {
    kind: "landing",
    tile: "t",
    position: at,
    properties: { k: "pier" },
  },
};

/** The variants whose heading or icon differs within a kind. */
const VARIANTS: Record<string, Inquiry> = {
  "osm conifer": { ...FIXTURES.tree, osm: true, conifer: true, genus: "" },
  "orchard tree": {
    ...FIXTURES.tree,
    osm: true,
    orchard: true,
    genus: "Malus",
  },
  playground: {
    ...FIXTURES.furniture,
    properties: { k: "playground" },
  },
  swing: { ...FIXTURES.furniture, properties: { k: "swing" } },
  "row tree": { kind: "canopy", tile: "t", position: at, source: "row" },
  "wall lamp": { ...FIXTURES.lamp, wall: "facade" },
  "hung lamp": { ...FIXTURES.lamp, hung: true },
};

const ALL: [string, Inquiry][] = [
  ...Object.values(FIXTURES).map((fx): [string, Inquiry] => [fx.kind, fx]),
  ...Object.entries(VARIANTS),
];

/** Dresden's credits, with the tree register (sites/dresden.ts). */
const credits = cardCredits({
  provider: { credit: "Quelle: GeoSN, dl-de/by-2-0", products: { dlm: true } },
  treeCadastre: {
    credit: "Stadtbäume: Landeshauptstadt Dresden, dl-de/by-2-0",
  },
});

const geosn = {
  credit: "Quelle: GeoSN, dl-de/by-2-0",
  licence: "dl-de/by-2-0",
};
const provenance: SiteProvenance = {
  version: 1,
  sources: {
    lod2: { label: "3D-Stadtmodell LoD2", ...geosn },
    lsc: { label: "Laserscan", ...geosn },
    dgm: { label: "Digitales Geländemodell DGM1", ...geosn },
    dom: { label: "Digitales Oberflächenmodell DOM1", ...geosn },
    dop: { label: "Digitales Orthophoto", ...geosn },
    dlm: { label: "Basis-DLM", ...geosn },
    trees: {
      label: "Stadtbaumkataster",
      credit: "Landeshauptstadt Dresden, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    wikidata: { label: "Wikidata", credit: "CC0", licence: "CC0" },
    osm: {
      label: "OpenStreetMap",
      credit: "© OpenStreetMap-Mitwirkende",
      licence: "ODbL",
      stand: "2026-09-26",
    },
  },
  tiles: {},
};

const treeFacts: TreeFacts = {
  german: "Winter-Linde",
  botanical: "Tilia cordata",
  place: "Grunaer Straße",
  nr: 40,
  age: 16,
  date: "2025-08-27",
  known: 1,
};

/** Each kind's own card function, called as its tests call it. */
function direct(i: Inquiry): InquiryCard | null {
  switch (i.kind) {
    case "building": {
      // buildingCard is the module's own; inquiry.test.ts pins its words
      return null;
    }
    case "tree": {
      return treeCard(i, treeFacts, provenance, credits);
    }
    case "monument": {
      return monumentCard(i, provenance, credits);
    }
    case "bridge": {
      return bridgeCard(i, provenance, credits);
    }
    case "traffic": {
      return trafficCard(i);
    }
    case "bikes": {
      return bikeCard(i);
    }
    case "design": {
      return designCard(i);
    }
    case "canopy": {
      return canopyCard(i, provenance, credits);
    }
    case "hedge": {
      return hedgeCard(i, provenance, credits);
    }
    case "lamp": {
      return lampCard(i, provenance, credits);
    }
    case "furniture": {
      return furnitureCard(i, provenance);
    }
    case "stop": {
      return stopCard(i, provenance);
    }
    case "landing": {
      return landingCard(i, provenance);
    }
    default: {
      const unknown: never = i;
      throw new Error(`unknown inquiry kind: ${String(unknown)}`);
    }
  }
}

describe("inquiryCard routes each kind to its card", () => {
  for (const [name, fx] of ALL) {
    const own = direct(fx);
    if (own) {
      test(name, () => {
        expect(inquiryCard(fx, provenance, credits, treeFacts)).toEqual(own);
      });
    }
  }
});

/** What the strip of candidates shows: the card's kicker and title with
 *  no provenance and no tree facts yet. */
const HEADINGS: Record<string, [string, string]> = {
  building: ["Kirche", "Dreikönigskirche"],
  tree: ["Stadtbaum", "Tilia"],
  monument: ["Brunnen", "Gänsedieb-Brunnen"],
  bridge: ["Straßenbrücke", "Albertbrücke"],
  traffic: ["Kfz-Verkehr", "Antonstraße"],
  bikes: ["Radzählstelle · live", "Albertbrücke"],
  design: ["Entwurf", "Außenwand Nord"],
  canopy: ["Baum", "Baum"],
  hedge: ["Hecke", "Hecke"],
  lamp: ["Straßenbeleuchtung", "Straßenlaterne"],
  furniture: ["Stadtmobiliar", "Bank"],
  stop: ["Straßenbahnhaltestelle", "Albertplatz"],
  landing: ["Am Fluss", "Anlegestelle"],
  "osm conifer": ["Baum", "Nadelbaum"],
  "orchard tree": ["Obstbaum", "Malus"],
  "row tree": ["Baum einer Baumreihe", "Baum"],
  playground: ["Spielplatz", "Spielplatz"],
  swing: ["Spielplatz", "Schaukel"],
  "wall lamp": ["Straßenbeleuchtung", "Wandleuchte"],
  "hung lamp": ["Straßenbeleuchtung", "Hängeleuchte"],
};

describe("each kind's heading, as the strip shows it", () => {
  for (const [name, fx] of ALL) {
    test(name, () => {
      const card = inquiryCard(fx, null, credits);
      expect([card.kicker, card.title]).toEqual(HEADINGS[name]);
    });
  }
});

/** The icon the strip draws each with. */
const ICONS: Record<string, KindIcon> = {
  building: "building",
  tree: "tree-deciduous",
  monument: "landmark",
  bridge: "bridge",
  traffic: "car",
  bikes: "bike",
  design: "pencil-ruler",
  canopy: "tree-deciduous",
  hedge: "shrub",
  lamp: "lamp-floor",
  furniture: "armchair",
  stop: "tram-front",
  landing: "anchor",
  "osm conifer": "tree-pine",
  "orchard tree": "tree-deciduous",
  "row tree": "tree-deciduous",
  playground: "ferris-wheel",
  swing: "ferris-wheel",
  "wall lamp": "lamp-floor",
  "hung lamp": "lamp-floor",
};

describe("kindLabel gives the strip the card's heading without the card", () => {
  for (const [name, fx] of ALL) {
    test(name, () => {
      const label = kindLabel(fx, credits);
      expect([label.kicker, label.title]).toEqual(HEADINGS[name]);
      expect(label.icon).toBe(ICONS[name]);
    });
  }
});

/** The probe's view of each: whether only nothing solid behind it lets it
 *  win, and the key it is voted by (none for a building). */
const PICKS: Record<string, [boolean, string | null]> = {
  building: [false, null],
  tree: [true, "tree:t:0"],
  monument: [false, "monument:t:411000,5656000"],
  bridge: [false, "bridge:t:411000,5656000"],
  traffic: [false, "traffic:t:0"],
  bikes: [false, "bikes:100:411000,5656000"],
  design: [false, "design:neubau.ifc:3"],
  canopy: [true, "canopy:t:411000,5656000"],
  hedge: [true, "hedge:t:411000,5656000"],
  lamp: [false, "lamp:t:411000,5656000"],
  furniture: [false, "furniture:t:411000,5656000"],
  stop: [false, "stop:t:411000,5656000"],
  landing: [false, "landing:t:411000,5656000"],
  "osm conifer": [true, "tree:t:0"],
  "orchard tree": [true, "tree:t:0"],
  "row tree": [true, "canopy:t:411000,5656000"],
  playground: [true, "furniture:t:411000,5656000"],
  swing: [false, "furniture:t:411000,5656000"],
  "wall lamp": [false, "lamp:t:411000,5656000"],
  "hung lamp": [false, "lamp:t:411000,5656000"],
};

describe("what the probe weighs each by", () => {
  for (const [name, fx] of ALL) {
    test(name, () => {
      const [porous, key] = PICKS[name];
      expect(isPorous(fx)).toBe(porous);
      expect(fx.kind === "building" ? null : thingKey(fx)).toBe(key);
    });
  }
});
