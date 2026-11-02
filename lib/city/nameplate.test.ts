import { expect, test } from "bun:test";
import type { InquiryCard } from "./card-lines";
import { OBJECT_FLAG_LANDMARK, OBJECT_SOURCE_LOD2 } from "./city-mesh";
import type { Inquiry, InquiryObject } from "./inquiry";
import {
  inquiryBuildings,
  isLandmarkInquiry,
  nameplateEave,
  nameplateText,
  titleLines,
} from "./nameplate";
import { NO_FACT, type ObjectFacts } from "./object-facts";

const facts = (over: Partial<ObjectFacts> = {}): ObjectFacts => ({
  buildingId: "DESN_a",
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

const card = (over: Partial<InquiryCard> = {}): InquiryCard => ({
  address: "",
  facts: [],
  id: "",
  idLabel: "",
  kicker: "",
  sources: [],
  title: "Gebäude",
  ...over,
});

const building = (tree: InquiryObject[]): Inquiry => ({
  kind: "building",
  tile: "t",
  picked: tree[0],
  tree,
});

test("a landmark: its name large, its facts under it", () => {
  const church = building([
    object({
      flags: OBJECT_FLAG_LANDMARK,
      facts: facts({ name: "Frauenkirche", height: 91.2 }),
    }),
  ]);
  expect(isLandmarkInquiry(church)).toBe(true);
  const text = nameplateText(church, card({ title: "Frauenkirche" }), {
    id: "Q157229",
    name: "Frauenkirche",
    buildings: ["DESN_a"],
    built: [1726, 1734],
  });
  expect(text).toEqual({
    rank: "landmark",
    title: "Frauenkirche",
    lines: ["erbaut 1726–1734", "91 m"],
  });
});

test("a named building: its name and address", () => {
  const text = nameplateText(
    building([object({ facts: facts({ name: "Kulturpalast" }) })]),
    card({ title: "Kulturpalast", address: "Schloßstraße 2" })
  );
  expect(text).toEqual({
    rank: "named",
    title: "Kulturpalast",
    lines: ["Schloßstraße 2"],
  });
});

test("an ordinary house shows its address small, or nothing", () => {
  const house = building([object()]);
  expect(nameplateText(house, card({ address: "Hauptstraße 5" }))).toEqual({
    rank: "address",
    title: "Hauptstraße 5",
    lines: [],
  });
  expect(nameplateText(house, card())).toBeNull();
});

test("a named bridge carries its kind; an unnamed one nothing", () => {
  const bridge = (name?: string): Inquiry => ({
    kind: "bridge",
    tile: "t",
    length: 100,
    position: [0, 0],
    properties: { kind: "road", ...(name ? { name } : {}) },
  });
  expect(
    nameplateText(bridge("Augustusbrücke"), card({ kicker: "Brücke" }))
  ).toEqual({ rank: "named", title: "Augustusbrücke", lines: ["Brücke"] });
  expect(nameplateText(bridge(), card())).toBeNull();
});

test("an ensemble's Buildings, each once", () => {
  const tree = [
    object({ facts: facts({ buildingId: "A" }) }),
    object({ facts: facts({ buildingId: "B" }) }),
    object({ building: false, facts: facts({ buildingId: "A" }) }),
  ];
  expect(inquiryBuildings(building(tree))).toEqual(["A", "B"]);
});

test("a thing of the street: its name and one small line", () => {
  const tree: Inquiry = {
    kind: "tree",
    conifer: false,
    genus: "Tilia",
    index: 0,
    osm: false,
    position: [0, 0],
    tile: "t",
    height: 14,
    crown: 8,
  };
  // the register's German name, its species under it
  expect(
    nameplateText(
      tree,
      card({
        title: "Winter-Linde",
        kicker: "Stadtbaum",
        facts: [{ label: "Art", value: "Tilia cordata" }],
      })
    )
  ).toEqual({
    rank: "object",
    title: "Winter-Linde",
    lines: ["Tilia cordata"],
  });
  // no species known: its kind
  expect(
    nameplateText(tree, card({ title: "Tilia", kicker: "Stadtbaum" }))
  ).toEqual({ rank: "object", title: "Tilia", lines: ["Stadtbaum"] });
  // an unnamed monument is a thing too
  const fountain: Inquiry = {
    kind: "monument",
    tile: "t",
    position: [0, 0],
    properties: { kind: "fountain" },
  };
  expect(
    nameplateText(fountain, card({ title: "Brunnen", kicker: "Brunnen" }))
  ).toEqual({ rank: "object", title: "Brunnen", lines: [] });
});

test("a long title breaks between words into even lines, a joined one at its slash", () => {
  expect(titleLines("Frauenkirche")).toEqual(["Frauenkirche"]);
  expect(titleLines("Sächsisches Staatsministerium für Kultus")).toEqual([
    "Sächsisches",
    "Staatsministerium für Kultus",
  ]);
  const joined = titleLines(
    "Sächsisches Staatsministerium für Kultus / Sächsisches Staatsministerium der Finanzen"
  );
  expect(joined.length).toBe(4);
  expect(joined.join(" ")).toBe(
    "Sächsisches Staatsministerium für Kultus Sächsisches Staatsministerium der Finanzen"
  );
  for (const line of joined) {
    expect(line.length).toBeLessThanOrEqual(30);
  }
  // one long word stays whole
  expect(titleLines("Donaudampfschifffahrtsgesellschaftskapitän")).toEqual([
    "Donaudampfschifffahrtsgesellschaftskapitän",
  ]);
});

test("the eave is the main mass's, over its own base", () => {
  // a tower (small, high eave) beside the nave (large, standing higher on
  // a slope than the tower's foot)
  const tower = object({
    baseZ: 100,
    eaveH: 40,
    facts: facts({ area: 80 }),
  });
  const nave = object({
    baseZ: 106,
    eaveH: 15,
    objectIndex: 1,
    facts: facts({ area: 900 }),
  });
  expect(nameplateEave(building([tower, nave]))).toEqual({
    baseZ: 106,
    eaveH: 15,
  });
  // asked without its tree: the picked object alone
  const alone: Inquiry = {
    kind: "building",
    tile: "t",
    picked: nave,
    tree: [],
  };
  expect(nameplateEave(alone)?.eaveH).toBe(15);
  // nothing states an eave: none
  expect(nameplateEave(building([object()]))).toBeNull();
});
