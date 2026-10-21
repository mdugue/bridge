import { expect, test } from "bun:test";
import {
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_SCAN,
} from "./city-mesh";
import { encodeDrawn } from "./drawn-facts";
import type { InquiryObject } from "./inquiry";
import type { TreeInquiry } from "./inquiry-features";
import type { LampInquiry } from "./inquiry-more";
import { type LineageEntry, type LineageSite, lineage } from "./lineage";
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
  drawn: "",
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

const said = (entry: LineageEntry) => entry.used.map((u) => u.text);

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
    "Im Viewer",
  ]);
  const [model, surface, osm] = entries;
  // the model edition, as the card says it; the portal to find it
  expect(model.stand).toBe("Modell 2024");
  expect(model.url).toBe("https://www.geodaten.sachsen.de/");
  // the rebuilt roof is the surface model's, not the model's
  expect(said(model).join()).not.toContain("Dachform");
  expect(surface.stand).toBe("01.03.2024");
  // a roof put in where the model misses the surface is detected, the
  // model's own lines are taken as published
  expect(surface.used.map((u) => u.method)).toEqual(["detected"]);
  expect(model.used.every((u) => u.method === "taken")).toBe(true);
  // a shop is a point matched to the footprint: detected; the material
  // where nothing is mapped is assumed
  expect(osm.used).toContainEqual({
    text: "Schaufenster im Erdgeschoss",
    method: "detected",
  });
  expect(osm.used).toContainEqual({
    text: "sonst Ziegel oder Putz wie in der Nachbarschaft",
    method: "assumed",
  });
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
    "Im Viewer",
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
    "Im Viewer",
  ]);
  expect(sources(lineage({ ...tree, osm: true }, provenance, noPhoto))).toEqual(
    ["OpenStreetMap", "Digitales Geländemodell DGM1", "Im Viewer"]
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
    "Im Viewer",
  ]);
});

test("an evergreen names what told it: the forest or the leaf-off photo", () => {
  const crown = {
    kind: "canopy" as const,
    tile: "t",
    position: [0, 0] as [number, number],
    source: "dom" as const,
  };
  const forest = lineage({ ...crown, evergreen: "forest" }, provenance, saxony);
  expect(sources(forest)).toContain("Basis-DLM");
  const photo = lineage({ ...crown, evergreen: "photo" }, provenance, saxony);
  expect(sources(photo)).not.toContain("Basis-DLM");
  const dop = photo.find((e) => e.source === "Digitales Orthophoto");
  expect(dop && said(dop)).toContain(
    "dass er immergrün ist: grün im laubfreien Luftbild"
  );
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
    "Im Viewer",
  ]);
  expect(entries[0].credit).toContain("ODbL");
});

test("an orchard's tree DOM1 measured names the surface model, not the orchard's default", () => {
  const entries = lineage(
    {
      kind: "tree",
      tile: "t",
      index: 4,
      position: [0, 0],
      osm: false,
      orchard: true,
      measured: true,
      conifer: false,
      genus: "",
      height: 6.2,
      crown: 5.3,
    },
    provenance,
    saxony
  );
  expect(sources(entries)).toEqual([
    "OpenStreetMap",
    "Digitales Oberflächenmodell DOM1",
    "Digitales Geländemodell DGM1",
    "Im Viewer",
  ]);
  expect(JSON.stringify(entries)).not.toContain("Vorgabe der Obstwiese");
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
    const deck = bridge.find((e) => said(e).includes("der Umriss des Decks"));
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

test("a lamp says the wall it hangs on and the carriageway its arm reaches over", () => {
  const used = (entries: LineageEntry[], source: string) =>
    entries.find((e) => e.source === source)?.used.map((u) => u.text) ?? [];
  const lamp: LampInquiry = { kind: "lamp", tile: "t", position: [0, 0] };
  const onWall = lineage({ ...lamp, wall: "wall" }, provenance, saxony);
  expect(used(onWall, "OpenStreetMap")).toEqual([
    "Standort",
    "die Mauer, an der die Leuchte hängt",
  ]);
  expect(used(onWall, "Digitales Geländemodell DGM1")).toContain(
    "die Seite der Mauer, an der sie hängt: die tiefere"
  );
  const mast = lineage(
    { ...lamp, arm: true, height: 9, heightFrom: "street" },
    provenance,
    saxony
  );
  expect(used(mast, "OpenStreetMap")).toEqual([
    "Standort",
    "die Fahrbahn, über die der Ausleger reicht",
  ]);
  // a lamp Mapillary found takes only its arm's carriageway from OSM
  const seen = lineage({ ...lamp, arm: true, src: "mly" }, provenance, saxony);
  expect(used(seen, "OpenStreetMap")).toEqual([
    "die Fahrbahn, über die der Ausleger reicht",
  ]);
  expect(used(lineage(lamp, provenance, saxony), "OpenStreetMap")).toEqual([
    "Standort",
  ]);
});

test("a building LoD2 lacks: OSM's outline, and its height the surface model's or OSM's", () => {
  const entry = (drawn: string, source: string) => {
    const b = object({ source: OBJECT_SOURCE_GAP, facts: facts({ drawn }) });
    const found = lineage(
      { kind: "building", tile: "t", picked: b, tree: [b] },
      provenance,
      saxony
    ).find((e) => e.source === source);
    return found?.used ?? [];
  };
  // measured: the surface model computes its height
  expect(entry("", "Digitales Oberflächenmodell DOM1")).toEqual([
    { text: "seine Höhe über Gelände und Stadtmodell", method: "computed" },
  ]);
  // newer than the flight: OSM's height, the surface model says why
  const newer = encodeDrawn({ height: "osm" });
  expect(entry(newer, "Digitales Oberflächenmodell DOM1")).toEqual([
    { text: "dass es beim Bildflug noch nicht stand", method: "detected" },
  ]);
  expect(entry(newer, "OpenStreetMap").map((u) => u.text)).toContain(
    "seine Höhe: die kartierte oder die Geschosse"
  );
});
