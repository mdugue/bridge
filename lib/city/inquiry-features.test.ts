import { expect, test } from "bun:test";
import type { TreeFactsFile } from "./features";
import {
  bridgeCard,
  canopyCard,
  furnitureCard,
  hedgeCard,
  lampCard,
  landingCard,
  monumentCard,
  stopCard,
  structureLabel,
  treeCard,
  treeFactsAt,
} from "./inquiry-features";
import type { TreeInquiry } from "./inquiry-features";
import type { SiteProvenance } from "./provenance";
import { cardCredits } from "./card-lines";
import type { CardCredits } from "./card-lines";
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
        furniture: "2026-11-07",
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
  position: [412_089.7, 5_656_000.4],
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
  expect(lines(card.sources).join(",")).not.toContain("Stadtbaumkataster");
});

test("an orchard tree DOM1 measured gives its height and crown, measured", () => {
  const card = treeCard(
    {
      ...linde,
      index: 2,
      osm: false,
      orchard: true,
      measured: true,
      genus: "Malus",
      height: 6.2,
      crown: 5.3,
    },
    treeFactsAt(file, 2),
    provenance,
    DRESDEN
  );
  expect(card.title).toBe("Malus");
  expect(card.facts.map((f) => f.label)).toEqual(["Höhe", "Krone"]);
  expect(card.sources.at(-1)?.method).toBe("detected");
  expect(card.sources.at(-1)?.text).toContain("Höhe und Krone gemessen");
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
  expect(lines(bridge.sources).join(",")).not.toContain("Basis-DLM");
  expect(
    [...lines(tree.sources), ...lines(bridge.sources)].join(",")
  ).not.toMatch(/GeoSN|Dresden/u);
});

test("a named fountain with a figure, its basin from OSM, its name official", () => {
  const card = monumentCard(
    {
      kind: "monument",
      tile: "t",
      position: [412_015, 5_656_853.7],
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
      position: [412_700, 5_656_900],
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

test("a statue typed by OSM: its form, maker and material, its name official", () => {
  const card = monumentCard(
    {
      kind: "monument",
      tile: "t",
      position: [411_600, 5_656_500],
      properties: {
        kind: "statue",
        name: "Martin-Luther-Denkmal",
        source: "dlm+osm",
        form: "statue",
        artist: "Adolf von Donndorf",
        material: "Bronze",
        height: 6,
      },
    },
    provenance,
    DRESDEN
  );
  expect(card.kicker).toBe("Standbild");
  expect(card.facts).toEqual([
    { label: "Werk von", value: "Adolf von Donndorf" },
    { label: "Material", value: "Bronze" },
    { label: "Höhe", value: "6 m" },
  ]);
  expect(lines(card.sources)).toEqual([
    "Name: Basis-DLM · Quelle: GeoSN, dl-de/by-2-0",
    "Art, Werk, Material, Höhe: OpenStreetMap · Stand 19.09.2026 · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
});

test("a monument whose material only Wikidata names quotes it for that", () => {
  const card = monumentCard(
    {
      kind: "monument",
      tile: "t",
      position: [411_791, 5_657_042],
      properties: {
        kind: "statue",
        name: "Goldener Reiter",
        source: "dlm",
        material: "Kupfer, Blattgold",
        materialWikidata: "Q558537",
        relief: { west: 0, north: 0, cols: 2, rows: 1, dm: [46, 70] },
      },
    },
    provenance,
    DRESDEN
  );
  expect(card.kicker).toBe("Denkmal");
  expect(card.facts).toEqual([
    { label: "Material", value: "Kupfer, Blattgold" },
    { label: "Höhe", value: "7 m" },
  ]);
  expect(lines(card.sources)).toEqual([
    "Name: Basis-DLM · Quelle: GeoSN, dl-de/by-2-0",
    "Material: Wikidata · Stand 26.09.2026 · CC0",
    "Höhe gemessen: Digitales Oberflächenmodell DOM1 · Quelle: GeoSN, dl-de/by-2-0",
  ]);
});

test("a column measured in the laser scan, a stele measured in the open", () => {
  const column = monumentCard(
    {
      kind: "monument",
      tile: "t",
      position: [412_000, 5_656_000],
      properties: {
        kind: "column",
        name: "Nikolaisäule",
        source: "osm",
        form: "column",
        hs: "lsc",
        relief: { west: 0, north: 0, cols: 2, rows: 1, dm: [154, 60] },
      },
    },
    provenance,
    DRESDEN
  );
  expect(column.kicker).toBe("Säule");
  expect(column.facts).toEqual([{ label: "Höhe", value: "15,4 m" }]);
  expect(lines(column.sources).at(-1)).toMatch(/^Höhe gemessen: Laserscan/u);
  const stele = monumentCard(
    {
      kind: "monument",
      tile: "t",
      position: [412_000, 5_656_000],
      properties: { kind: "statue", source: "osm", form: "stele", hm: 2.4 },
    },
    provenance,
    DRESDEN
  );
  expect(stele.facts).toEqual([{ label: "Höhe", value: "2,4 m" }]);
  expect(lines(stele.sources).at(-1)).toMatch(
    /^Höhe gemessen: Digitales Oberflächenmodell DOM1/u
  );
  // a tagged height is OSM's, not a measurement
  const tagged = monumentCard(
    {
      kind: "monument",
      tile: "t",
      position: [412_000, 5_656_000],
      properties: { kind: "statue", source: "osm", height: 3, hm: 2.4 },
    },
    provenance,
    DRESDEN
  );
  expect(tagged.facts).toEqual([{ label: "Höhe", value: "3 m" }]);
  expect(lines(tagged.sources).join(",")).not.toContain("gemessen");
});

/** Hamburg's: no Basis-DLM, its hedges and tree rows are OSM's. */
const HAMBURG: CardCredits = {
  dlm: false,
  provider: "Freie und Hansestadt Hamburg, LGV, dl-de/by-2-0",
};

const at: [number, number] = [411_000, 5_656_000];

test("a tree without a register says what was measured, and no species", () => {
  const card = canopyCard(
    { kind: "canopy", tile: "t", position: at, source: "dom", height: 17.4 },
    null,
    DRESDEN
  );
  expect(card.facts).toContainEqual({
    label: "Höhe",
    value: "17,4 m, gemessen",
  });
  expect(card.facts).toContainEqual({ label: "Art", value: "nicht bekannt" });
  expect(card.sources[0]?.text).toContain("Digitales Oberflächenmodell DOM1");
  // the crown's place is found in the surface, not measured as such
  expect(card.sources[0]?.method).toBe("detected");
  expect(card.address).toBe("Eine Krone, im Oberflächenmodell erkannt");
});

test("an evergreen says what told it: the forest's kind or the photo", () => {
  const crown = { kind: "canopy" as const, tile: "t", position: at };
  const forest = canopyCard(
    { ...crown, source: "dom", evergreen: "forest" },
    null,
    DRESDEN
  );
  expect(forest.facts).toContainEqual({
    label: "Laub",
    value: "Nadelbaum, immergrün",
  });
  expect(lines(forest.sources).at(-1)).toContain("Basis-DLM");
  // without a Basis-DLM the wood's leaf type is OSM's
  const hamburg = canopyCard(
    { ...crown, source: "dom", evergreen: "forest" },
    null,
    HAMBURG
  );
  expect(lines(hamburg.sources).at(-1)).toContain("OpenStreetMap");
  const photo = canopyCard(
    { ...crown, source: "dom", evergreen: "photo" },
    null,
    DRESDEN
  );
  expect(photo.sources.at(-1)?.text).toContain("Digitales Orthophoto");
  expect(photo.sources.at(-1)?.method).toBe("detected");
  const broadleaf = canopyCard({ ...crown, source: "dom" }, null, DRESDEN);
  expect(broadleaf.facts.map((f) => f.label)).not.toContain("Laub");
  expect(broadleaf.sources).toHaveLength(1);
});

test("a hedge's height is measured only where the laser scan said so", () => {
  const hedge = { kind: "hedge" as const, tile: "t", position: at, length: 42 };
  const scanned = hedgeCard(
    { ...hedge, source: "osm+lsc", height: 2 },
    null,
    DRESDEN
  );
  expect(scanned.facts[0].value).toBe("2 m, gemessen");
  expect(lines(scanned.sources)).toHaveLength(2);
  const tagged = hedgeCard(
    { ...hedge, source: "osm", height: 2 },
    null,
    DRESDEN
  );
  expect(tagged.facts[0].value).toBe("2 m");
});

test("a hedge DOM1 measured, and one the scan found itself, say where from", () => {
  const hedge = { kind: "hedge" as const, tile: "t", position: at, length: 12 };
  const dom = hedgeCard(
    { ...hedge, source: "osm+dom", height: 2 },
    null,
    DRESDEN
  );
  expect(dom.facts[0].value).toBe("2 m, gemessen");
  expect(lines(dom.sources)).toHaveLength(2);
  expect(lines(dom.sources).join(" ")).toContain("Oberflächenmodell");
  const scan = hedgeCard({ ...hedge, source: "lsc", height: 2 }, null, DRESDEN);
  expect(scan.facts[0].value).toBe("2 m, gemessen");
  expect(lines(scan.sources)).toHaveLength(1);
  expect(lines(scan.sources)[0]).toContain("Laserscan");
});

test("a tree row or hedge credits the site's own source, not GeoSN", () => {
  const row = { kind: "canopy" as const, tile: "t", position: at };
  const dresden = canopyCard({ ...row, source: "row" }, null, DRESDEN);
  expect(dresden.sources[0]?.text).toContain("Basis-DLM");
  expect(dresden.sources[0]?.text).toContain("GeoSN");
  const hamburg = canopyCard({ ...row, source: "row" }, null, HAMBURG);
  expect(hamburg.sources[0]?.text).toContain("OpenStreetMap");
  expect(hamburg.sources[0]?.text).not.toContain("GeoSN");
  const scan = canopyCard({ ...row, source: "lsc" }, null, HAMBURG);
  expect(scan.sources[0]?.text).toContain("LGV");
  const hedge = hedgeCard(
    { kind: "hedge", tile: "t", position: at, length: 12, source: "dlm" },
    null,
    HAMBURG
  );
  expect(hedge.sources[0]?.text).toContain("OpenStreetMap");
});

test("a lamp's post is assumed, and the card says so", () => {
  const card = lampCard(
    { kind: "lamp", tile: "t", position: at },
    null,
    DRESDEN
  );
  expect(card.facts).toEqual([
    { label: "Mast", value: "5 m, angenommen", method: "assumed" },
  ]);
});

test("a lamp whose street the surface model measured says so", () => {
  const lamp = { kind: "lamp" as const, tile: "t", position: at };
  const street = lampCard(
    { ...lamp, height: 9.5, heightFrom: "street" },
    null,
    DRESDEN
  );
  expect(street.facts).toEqual([
    {
      label: "Mast",
      value: "9,5 m, wie an den Laternen der Straße gemessen",
      method: "computed",
    },
  ]);
  expect(lines(street.sources).at(-1)).toContain(
    "Digitales Oberflächenmodell DOM1"
  );
  const kind = lampCard(
    { ...lamp, height: 6, heightFrom: "class" },
    null,
    DRESDEN
  );
  expect(kind.facts[0].value).toBe(
    "6 m, wie an den Laternen dieser Art Straße gemessen"
  );
});

test("a lamp hung across the street has no post, and says how it hangs", () => {
  const card = lampCard(
    { kind: "lamp", tile: "t", position: at, hung: true },
    null,
    DRESDEN
  );
  expect(card.facts.map((f) => f.label)).toEqual(["Aufhängung", "Höhe"]);
});

test("a lamp or bin Mapillary detected names Mapillary, not OSM", () => {
  const lamp = lampCard(
    { kind: "lamp", tile: "t", position: at, src: "mly" },
    null,
    DRESDEN
  );
  expect(lamp.sources[0]?.text).toStartWith("Laterne: Mapillary");
  expect(lamp.sources[0]?.text).toContain("CC BY-SA 4.0");
  const bin = furnitureCard(
    {
      kind: "furniture",
      tile: "t",
      position: at,
      properties: { k: "bin", src: "mly" },
    },
    null
  );
  expect(bin.sources[0]?.text).toStartWith("Papierkorb: Mapillary");
  const osmLamp = lampCard(
    { kind: "lamp", tile: "t", position: at },
    null,
    DRESDEN
  );
  expect(osmLamp.sources[0]?.text).toContain("OpenStreetMap");
});

test("a bench faces where OSM or the nearest way says", () => {
  const card = furnitureCard(
    {
      kind: "furniture",
      tile: "t",
      position: at,
      properties: { k: "bench", a: 225, back: false, l: 2 },
    },
    null
  );
  expect(card.facts).toContainEqual({ label: "Lehne", value: "ohne" });
  expect(card.facts).toContainEqual({
    label: "Ausrichtung",
    value: "nach Südwesten",
  });
});

test("a lantern on a facade says where it hangs and that its height is assumed", () => {
  const card = lampCard(
    { kind: "lamp", tile: "t", position: at, wall: "facade", height: 3.5 },
    null,
    DRESDEN
  );
  expect(card.facts).toEqual([
    { label: "Aufhängung", value: "an der Fassade" },
    { label: "Höhe", value: "3,5 m, angenommen", method: "assumed" },
  ]);
  expect(card.sources[0]?.text).toContain("OpenStreetMap");
  // with no building near, on a mapped wall
  const onWall = lampCard(
    { kind: "lamp", tile: "t", position: at, wall: "wall", height: 2.5 },
    null,
    DRESDEN
  );
  expect(onWall.facts[0]).toEqual({
    label: "Aufhängung",
    value: "an der Mauer",
  });
});

test("a tall mast's card names its arm, and says it is assumed", () => {
  const lamp = { kind: "lamp" as const, tile: "t", position: at };
  const one = lampCard(
    { ...lamp, height: 9.5, heightFrom: "street", arm: true },
    null,
    DRESDEN
  );
  expect(one.facts).toContainEqual({
    label: "Ausleger",
    value: "zur Fahrbahn, angenommen",
    method: "assumed",
  });
  // a post with its head on top has no arm line
  const post = lampCard({ ...lamp }, null, DRESDEN);
  expect(post.facts.some((f) => f.label === "Ausleger")).toBe(false);
});

/** An OSM record whose street-tree product is older than the extract. */
const osmProvenance: SiteProvenance = {
  version: 1,
  sources: {
    osm: {
      label: "OpenStreetMap",
      credit: "© OpenStreetMap-Mitwirkende",
      licence: "ODbL",
      stand: "2026-09-26",
      stands: { trees: "2026-07-01" },
    },
  } as SiteProvenance["sources"],
  tiles: {},
};

test("a tram stop and a landing stage credit OSM, at the edition of its point layers", () => {
  const stop = stopCard(
    { kind: "stop", tile: "t", position: at, name: "Albertplatz" },
    osmProvenance
  );
  const landing = landingCard(
    { kind: "landing", tile: "t", position: at, properties: { k: "pier" } },
    osmProvenance
  );
  // the point layers quote the `trees` product's edition, not the extract's
  expect(lines(stop.sources)).toEqual([
    "Name, Lage: OpenStreetMap · Stand 01.07.2026 · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
  expect(lines(landing.sources)).toEqual([
    "Anlegestelle: OpenStreetMap · Stand 01.07.2026 · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
  expect(stop.sources[0]?.method).toBe("taken");
  // before the manifest arrives: OSM's own credit, no edition
  const bare = stopCard(
    { kind: "stop", tile: "t", position: at, name: "" },
    null
  );
  expect(lines(bare.sources)).toEqual([
    "Name, Lage: OpenStreetMap · © OpenStreetMap-Mitwirkende, ODbL",
  ]);
});

test("a playground piece found in the surface model says it was measured there", () => {
  const card = furnitureCard(
    {
      kind: "furniture",
      tile: "t",
      position: at,
      properties: { k: "playground", src: "dom", h: 2.5 },
    },
    null
  );
  expect(card.sources).toHaveLength(1);
  expect(card.sources[0]?.method).toBe("computed");
  expect(card.sources[0]?.text).toBe(
    "Lage und Höhe gemessen: Digitales Oberflächenmodell DOM1"
  );
});

test("a piece of furniture quotes its own extract's edition, not the trees'", () => {
  const card = furnitureCard(
    {
      kind: "furniture",
      tile: "t",
      position: at,
      properties: { k: "flag" },
    },
    provenance
  );
  expect(card.sources[0]?.text).toContain("Stand 07.11.2026");
});
