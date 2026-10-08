import { expect, test } from "bun:test";
import type { TreeFactsFile } from "./features";
import {
  bridgeCard,
  monumentCard,
  structureLabel,
  type TreeInquiry,
  treeCard,
  treeFactsAt,
} from "./inquiry-features";
import type { SiteProvenance } from "./provenance";
import { type CardCredits, cardCredits } from "./card-lines";
import type { Stated } from "./methods";

const lines = (sources: readonly Stated[]) => sources.map((l) => l.text);

/** Dresden's credits as the HUD hands them over (sites/). */
const DRESDEN: CardCredits = cardCredits({
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
    osm: {
      label: "OpenStreetMap",
      credit: "© OpenStreetMap-Mitwirkende",
      licence: "ODbL",
      stand: "2026-09-26",
      stands: {
        bridges: "2026-09-19",
        fountains: "2026-09-19",
        trees: "2026-09-26",
      },
    },
    trees: {
      label: "Stadtbaumkataster",
      credit: "Landeshauptstadt Dresden, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
      stand: "2026-10-01",
    },
    wikidata: {
      label: "Wikidata",
      credit: "CC0",
      licence: "CC0",
      stand: "2026-09-26",
    },
  },
  tiles: {},
};

const file: TreeFactsFile = {
  attribution: "Stadtbaumkataster © Landeshauptstadt Dresden (dl-de/by-2-0)",
  count: 2,
  names: [["Winter-Linde", "Tilia cordata"]],
  places: ["Grunaer Straße"],
  dates: ["2025-08-27"],
  name: [0, -1],
  place: [0, -1],
  nr: [40, -1],
  age: [16, -1],
  date: [0, -1],
  known: [1 | 4, 0],
};

const linde: TreeInquiry = {
  kind: "tree",
  tile: "t",
  index: 0,
  position: [412089.7, 5656000.4],
  osm: false,
  conifer: false,
  genus: "Tilia",
  height: 6,
  crown: 2.4,
  trunk: 9,
};

test("a register tree: species, place, the measured sizes only, its age", () => {
  const card = treeCard(linde, treeFactsAt(file, 0), provenance, DRESDEN);
  expect(card.kicker).toBe("Stadtbaum");
  expect(card.title).toBe("Winter-Linde");
  expect(card.address).toBe("Grunaer Straße · Baum Nr. 40");
  expect(card.facts).toEqual([
    { label: "Art", value: "Tilia cordata" },
    { label: "Höhe", value: "6 m" },
    // the crown was filled in from the tile's statistics: no line
    { label: "Stamm", value: "Ø 9 cm" },
    { label: "Alter", value: "16 Jahre (Eintrag vom 27.08.2025)" },
  ]);
  expect(card.id).toBe("412089.7 5656000.4");
  expect(card.idLabel).toBe("Lage");
  expect(lines(card.sources)).toEqual([
    "Art, Maße: Stadtbaumkataster · Stand 01.10.2026 · Landeshauptstadt Dresden, dl-de/by-2-0",
  ]);
});

test("before its facts arrive a tree says its genus, nothing it cannot", () => {
  const card = treeCard(linde, null, provenance, DRESDEN);
  expect(card.title).toBe("Tilia");
  expect(card.facts).toEqual([]);
  // an OSM tree with no genus is the kind of tree it is, credited to OSM
  const osm = treeCard(
    { ...linde, osm: true, genus: "", conifer: true },
    treeFactsAt(file, 1),
    provenance,
    DRESDEN
  );
  expect(osm.kicker).toBe("Baum");
  expect(osm.title).toBe("Nadelbaum");
  expect(lines(osm.sources)).toEqual([
    "Baum: OpenStreetMap · Stand 26.09.2026 · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
});

test("an orchard tree says it is one, from OSM's orchard, with no register line", () => {
  // past the facts file's end: no row of its own
  const card = treeCard(
    { ...linde, index: 2, osm: false, orchard: true, genus: "" },
    treeFactsAt(file, 2),
    provenance,
    DRESDEN
  );
  expect(card.kicker).toBe("Obstbaum");
  expect(card.title).toBe("Obstbaum");
  expect(card.facts).toEqual([]);
  expect(lines(card.sources)).toEqual([
    "Obstwiese: OpenStreetMap · Stand 26.09.2026 · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
  expect(lines(card.sources).join()).not.toContain("Stadtbaumkataster");
});

test("without the manifest the register and the surveys are the site's own", () => {
  expect(DRESDEN.register).toBe("Landeshauptstadt Dresden, dl-de/by-2-0");
  const hamburg: CardCredits = {
    dlm: false,
    provider: "Quelle: LGV Hamburg, dl-de/by-2-0",
    register: "Freie und Hansestadt Hamburg, dl-de/by-2-0",
  };
  const tree = treeCard(linde, treeFactsAt(file, 0), null, hamburg);
  expect(lines(tree.sources)).toEqual([
    "Art, Maße: Stadtbaumkataster · Freie und Hansestadt Hamburg, dl-de/by-2-0",
  ]);
  // a site without a register has OSM's trees: no register is named, and
  // its provider is not credited for one
  const munich = treeCard(linde, treeFactsAt(file, 0), null, {
    dlm: true,
    provider: "Bayerische Vermessungsverwaltung, CC BY 4.0",
  });
  expect(munich.kicker).toBe("Baum");
  expect(lines(munich.sources)).toEqual([
    "Art, Maße: OpenStreetMap · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
  const bridge = bridgeCard(
    {
      kind: "bridge",
      tile: "t",
      length: 0,
      position: [0, 0],
      properties: { kind: "road" },
    },
    null,
    hamburg
  );
  // no Basis-DLM in Hamburg: the bridge's area is OSM's, its deck the DOM1's
  expect(lines(bridge.sources)).toEqual([
    "Fläche: OpenStreetMap · © OpenStreetMap-Mitwirkende, ODbL",
    "Deck im DOM1 gemessen: Digitales Oberflächenmodell DOM1 · Quelle: LGV Hamburg, dl-de/by-2-0",
  ]);
  expect(lines(bridge.sources).join()).not.toContain("Basis-DLM");
  expect([...lines(tree.sources), ...lines(bridge.sources)].join()).not.toMatch(
    /GeoSN|Dresden/u
  );
});

test("a named fountain with a figure, its basin from OSM, its name official", () => {
  const card = monumentCard(
    {
      kind: "monument",
      tile: "t",
      position: [412015, 5656853.7],
      properties: {
        kind: "fountain",
        name: "Gänsedieb-Brunnen",
        source: "dlm+osm",
        style: "basin",
        figure: true,
        relief: { west: 0, north: 0, cols: 2, rows: 1, dm: [12, 31] },
      },
    },
    provenance,
    DRESDEN
  );
  expect(card.kicker).toBe("Brunnen");
  expect(card.title).toBe("Gänsedieb-Brunnen");
  expect(card.facts).toEqual([
    { label: "Form", value: "Becken mit Wasserspiel" },
    { label: "Skulptur", value: "im Becken" },
    { label: "Höhe", value: "3,1 m" },
  ]);
  expect(lines(card.sources)).toEqual([
    "Name: Basis-DLM · Quelle: GeoSN, dl-de/by-2-0",
    "Becken: OpenStreetMap · Stand 19.09.2026 · © OpenStreetMap-Mitwirkende, ODbL",
    "Höhe gemessen: Digitales Oberflächenmodell DOM1 · Quelle: GeoSN, dl-de/by-2-0",
  ]);
});

test("a bridge: name and deck from the DLM, structure and span from Wikidata", () => {
  const card = bridgeCard(
    {
      kind: "bridge",
      tile: "t",
      length: 263.4,
      position: [412700, 5656900],
      properties: {
        name: "Albertbrücke",
        kind: "road",
        structure: "arch",
        wikidata: "Q315427",
        span: 31.5,
        clearance: 5.6,
      },
    },
    provenance,
    DRESDEN
  );
  expect(card.kicker).toBe("Straßenbrücke");
  expect(card.title).toBe("Albertbrücke");
  expect(card.facts).toEqual([
    { label: "Tragwerk", value: "Bogen" },
    { label: "Länge", value: "263,4 m" },
    { label: "Hauptspannweite", value: "31,5 m" },
    { label: "Durchfahrtshöhe", value: "5,6 m" },
  ]);
  expect(card.id).toBe("Q315427");
  expect(card.idLabel).toBe("Wikidata");
  expect(lines(card.sources)).toEqual([
    "Name, Fläche: Basis-DLM · Quelle: GeoSN, dl-de/by-2-0",
    "Deck im DOM1 gemessen: Digitales Oberflächenmodell DOM1 · Quelle: GeoSN, dl-de/by-2-0",
    "Tragwerk, Spannweite: Wikidata · Stand 26.09.2026 · CC0",
    "Durchfahrtshöhe: OpenStreetMap · Stand 19.09.2026 · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
  // the area as the DLM publishes it, the deck computed from the surface
  expect(card.sources.map((l) => l.method)).toEqual([
    "taken",
    "computed",
    "taken",
    "taken",
  ]);
  expect(structureLabel("beam;arch")).toBe("Balken · Bogen");
  expect(structureLabel(null)).toBe("");
});
