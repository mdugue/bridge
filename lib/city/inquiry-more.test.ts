import { expect, test } from "bun:test";
import type { CardCredits } from "./card-lines";
import {
  canopyCard,
  furnitureCard,
  hedgeCard,
  lampCard,
  landingCard,
  stopCard,
} from "./inquiry-more";
import type { Stated } from "./methods";
import type { SiteProvenance } from "./provenance";

const lines = (sources: readonly Stated[]) => sources.map((l) => l.text);

/** Dresden's credits (sites/providers.ts) as the HUD hands them over. */
const DRESDEN: CardCredits = {
  dlm: true,
  provider: "Quelle: GeoSN, dl-de/by-2-0",
};
/** Hamburg's: no Basis-DLM, its hedges and tree rows are OSM's. */
const HAMBURG: CardCredits = {
  dlm: false,
  provider: "Freie und Hansestadt Hamburg, LGV, dl-de/by-2-0",
};

const at: [number, number] = [411000, 5656000];

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
  expect(card.title).toBe("Hängeleuchte");
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
  expect(card.title).toBe("Bank");
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
  expect(card.title).toBe("Wandleuchte");
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
