import { expect, test } from "bun:test";
import {
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_SCAN,
} from "./city-mesh";
import type { InquiryObject } from "./inquiry";
import type { TreeInquiry } from "./inquiry-features";
import { type LineageSite, lineage } from "./lineage";
import { MEASURED_ROOF, NO_FACT, type ObjectFacts } from "./object-facts";
import type { SiteProvenance } from "./provenance";

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
    },
    trees: {
      label: "Stadtbaumkataster",
      credit: "Landeshauptstadt Dresden, dl-de/by-2-0",
      licence: "dl-de/by-2-0",
    },
    wikidata: { label: "Wikidata", credit: "CC0", licence: "CC0" },
  },
  tiles: {
    t: {
      lod2: "2024 (LSC: 2016, Basis-DLM: 2022, DGM: 2016)",
      dom: "2024-03-01",
    },
  },
};

const saxony: LineageSite = {
  provider: {
    credit: "Quelle: GeoSN, dl-de/by-2-0",
    portal: "https://www.geodaten.sachsen.de/",
    products: { dom: true, dop: "rgbi", dlm: true, lsc: true },
  },
};

const facts = (over: Partial<ObjectFacts> = {}): ObjectFacts => ({
  buildingId: "DESNATPU1000HJx5",
  function: "",
  roofType: "",
  created: "",
  name: "",
  addr: "",
  height: NO_FACT,
  roofPitch: NO_FACT,
  area: NO_FACT,
  levels: NO_FACT,
  ...over,
});

const object = (over: Partial<InquiryObject> = {}): InquiryObject => ({
  building: true,
  eaveH: 0,
  facts: facts(),
  flags: 0,
  objectIndex: 0,
  source: OBJECT_SOURCE_LOD2,
  ...over,
});

const sources = (entries: ReturnType<typeof lineage>) =>
  entries.map((e) => e.source);

test("a LoD2 building whose roof was rebuilt: the model, the surface model for the roof, the photo's roof colour", () => {
  const picked = object({
    flags: OBJECT_FLAG_SHOP,
    facts: facts({ roofType: MEASURED_ROOF }),
  });
  const entries = lineage(
    { kind: "building", tile: "t", picked, tree: [picked] },
    provenance,
    saxony
  );
  expect(sources(entries)).toEqual([
    "3D-Stadtmodell LoD2",
    "Digitales Oberflächenmodell DOM1",
    "OpenStreetMap",
    "Digitales Orthophoto",
    "Digitales Geländemodell DGM1",
    "Im Viewer berechnet",
  ]);
  const [model, surface, osm] = entries;
  // the model edition, as the card says it; the portal to find it
  expect(model.stand).toBe("Modell 2024");
  expect(model.url).toBe("https://www.geodaten.sachsen.de/");
  // the rebuilt roof is the surface model's, not the model's
  expect(model.used.join()).not.toContain("Dachform");
  expect(surface.stand).toBe("01.03.2024");
  expect(osm.used).toContain("Schaufenster im Erdgeschoss");
  expect(osm.credit).toBe("© OpenStreetMap-Mitwirkende, ODbL");
  // the viewer's own work credits nobody
  expect(entries.at(-1)?.credit).toBe("");
});

test("a shed from the laser scan claims neither the model nor a roof colour", () => {
  const shed = object({ source: OBJECT_SOURCE_SCAN });
  const entries = lineage(
    { kind: "building", tile: "t", picked: shed, tree: [shed] },
    null,
    saxony
  );
  expect(sources(entries)).toEqual([
    "Laserscan",
    "Digitales Geländemodell DGM1",
    "Im Viewer berechnet",
  ]);
  // without the manifest the provider's credit still stands
  expect(entries[0].credit).toBe("Quelle: GeoSN, dl-de/by-2-0");
});

test("a tree: its register, or OSM; the leaf colour only where the photo has bands for it", () => {
  const tree: TreeInquiry = {
    kind: "tree",
    tile: "t",
    index: 0,
    position: [0, 0],
    osm: false,
    conifer: false,
    genus: "Tilia",
    height: 14,
    crown: 9,
  };
  const noPhoto: LineageSite = {
    provider: {
      ...saxony.provider,
      products: { ...saxony.provider.products, dop: null },
    },
  };
  expect(sources(lineage(tree, provenance, saxony))).toEqual([
    "Stadtbaumkataster",
    "Digitales Geländemodell DGM1",
    "Digitales Orthophoto",
    "Im Viewer berechnet",
  ]);
  expect(sources(lineage({ ...tree, osm: true }, provenance, noPhoto))).toEqual(
    ["OpenStreetMap", "Digitales Geländemodell DGM1", "Im Viewer berechnet"]
  );
});

test("a bridge matched to Wikidata links its item", () => {
  const entries = lineage(
    {
      kind: "bridge",
      tile: "t",
      length: 300,
      position: [0, 0],
      properties: { structure: "arch", wikidata: "Q20656" },
    },
    provenance,
    saxony
  );
  expect(entries.find((e) => e.source === "Wikidata")?.url).toBe(
    "https://www.wikidata.org/wiki/Q20656"
  );
  // the class came from Wikidata: OSM gave nothing here
  expect(sources(entries)).not.toContain("OpenStreetMap");
});

test("a tree the surface model measured names the model, not a register", () => {
  const entries = lineage(
    { kind: "canopy", tile: "t", position: [0, 0], source: "dom", height: 12 },
    provenance,
    saxony
  );
  expect(sources(entries)).toEqual([
    "Digitales Oberflächenmodell DOM1",
    "Digitales Geländemodell DGM1",
    "Digitales Orthophoto",
    "Im Viewer berechnet",
  ]);
});

test("an orchard's tree names OSM's orchard, not the city's register", () => {
  const entries = lineage(
    {
      kind: "tree",
      tile: "t",
      index: 4,
      position: [0, 0],
      osm: false,
      orchard: true,
      conifer: false,
      genus: "",
      height: 4.5,
      crown: 4,
    },
    provenance,
    saxony
  );
  expect(sources(entries)).toEqual([
    "OpenStreetMap",
    "Digitales Geländemodell DGM1",
    "Im Viewer berechnet",
  ]);
  expect(entries[0].credit).toContain("ODbL");
});

test("without a Basis-DLM a bridge's deck and a tree row are OSM's, with its licence and link", () => {
  const hamburg: LineageSite = {
    provider: {
      credit: "Freie und Hansestadt Hamburg, LGV, dl-de/by-2-0",
      portal: "https://geoportal-hamburg.de/",
      products: { dom: true, dop: "rgbi", dlm: false, lsc: false },
    },
  };
  const osmStands: SiteProvenance = {
    ...provenance,
    sources: {
      ...provenance.sources,
      osm: {
        ...provenance.sources.osm,
        stands: { bridges: "2026-08-01", trees: "2026-07-01" },
      },
    },
  };
  for (const manifest of [osmStands, null]) {
    const bridge = lineage(
      {
        kind: "bridge",
        tile: "t",
        length: 120,
        position: [0, 0],
        properties: {},
      },
      manifest,
      hamburg
    );
    expect(sources(bridge)).not.toContain("Basis-DLM");
    const deck = bridge.find((e) => e.used.includes("der Umriss des Decks"));
    expect(deck?.source).toBe("OpenStreetMap");
    expect(deck?.credit).toContain("ODbL");
    expect(deck?.url).toBe("https://www.openstreetmap.org/copyright");
    const row = lineage(
      { kind: "canopy", tile: "t", position: [0, 0], source: "row" },
      manifest,
      hamburg
    );
    expect(sources(row)).not.toContain("Basis-DLM");
    expect(row[0].source).toBe("OpenStreetMap");
  }
  const deck = lineage(
    {
      kind: "bridge",
      tile: "t",
      length: 120,
      position: [0, 0],
      properties: {},
    },
    osmStands,
    hamburg
  )[0];
  expect(deck.stand).toBe("01.08.2026");
});
