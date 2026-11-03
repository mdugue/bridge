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
import { NO_FACT } from "./object-facts";
import type { ObjectFacts } from "./object-facts";

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

const bridge = (name?: string): Inquiry => ({
  kind: "bridge",
  tile: "t",
  length: 100,
  position: [0, 0],
  properties: { kind: "road", ...(name ? { name } : {}) },
});

test("a named bridge carries its kind; an unnamed one nothing", () => {
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

const at = (
  baseZ: number,
  eaveH: number,
  area: number,
  over: Partial<InquiryObject> = {}
) =>
  object({
    baseZ,
    eaveH,
    flags: OBJECT_FLAG_LANDMARK,
    facts: facts({ area }),
    ...over,
  });

const eave = (tree: InquiryObject[]) => nameplateEave(building(tree));

const plain = (o: InquiryObject) => ({ ...o, flags: 0 });

test("a landmark's rooftop letters stand on the eave under its tower", () => {
  // the nave as the root (a lead, its area the whole tree's), the tower
  // a slender part (6 m wide, 40 m to its eave), a sacristy: on the nave
  const nave = at(106, 15, 1000, { lead: true });
  const tower = at(100, 40, 36, { building: false, objectIndex: 1 });
  const sacristy = at(104, 4, 60, { building: false, objectIndex: 2 });
  expect(eave([nave, tower, sacristy])).toBe(121);
  // the nave a part beside its own root, a sacristy (a lead whose area
  // is the tree's), and a turret without a footprint fact: on the nave
  const sacristyRoot = at(104, 4, 1500, { lead: true });
  const navePart = at(106, 15, 900, { building: false, objectIndex: 3 });
  const turret = at(106, 18, NO_FACT, { building: false, objectIndex: 4 });
  expect(eave([sacristyRoot, navePart, tower, turret])).toBe(121);
  // an ensemble of a tower Building and its nave Building: on the nave
  // where the nave leads; where the tower leads (its area the
  // ensemble's) it is not judged slender and the letters stand on top
  const towerBuilding = at(100, 40, 36, { objectIndex: 5 });
  const naveBuilding = at(106, 15, 900, { objectIndex: 6 });
  expect(eave([{ ...naveBuilding, lead: true }, towerBuilding])).toBe(121);
  expect(eave([{ ...towerBuilding, lead: true }, naveBuilding])).toBeNull();
  // the nave alone: nothing over it
  expect(eave([nave])).toBeNull();
  // two broad parts under the tower on a slope: the higher eave in
  // height (the nave up the slope, not the hall below it)
  const upNave = at(106, 15, 900, { building: false, objectIndex: 7 });
  const lowHall = at(95, 18, 700, { building: false, objectIndex: 8 });
  expect(eave([upNave, lowHall, at(95, 40, 36, { objectIndex: 9 })])).toBe(121);
  // a tall house over its courtyard wing (not slender), a wing up the
  // slope, a copy from the next tile: the letters on the top
  const house = at(110, 17, 250);
  expect(eave([house, at(110, 4, 80, { objectIndex: 10 })])).toBeNull();
  expect(eave([at(100, 8, 150), at(107, 8, 140, { objectIndex: 11 })])).toBe(
    null
  );
  expect(eave([house, { ...house }])).toBeNull();
  // a nave up the slope whose eave stands over the tower's: none
  expect(
    eave([
      at(115, 15, 900),
      at(95, 30, 36, { building: false, objectIndex: 12 }),
    ])
  ).toBeNull();
  // a base of exactly 0 (a table without the column): no frame to
  // stand in, the letters on the top
  expect(
    eave([
      at(0, 15, 900, { building: false }),
      at(0, 40, 36, { building: false, objectIndex: 13 }),
    ])
  ).toBeNull();
  // footprints unknown (an older bake), a Building drawn by its parts
  // alone (no eave), a surface-model addition with its host's facts:
  // none of them a tower
  expect(eave([at(106, 15, NO_FACT), at(100, 40, NO_FACT)])).toBeNull();
  expect(eave([at(0, 0, 36), at(130, 40, 36, { source: 2 }), house])).toBe(
    null
  );
  // a broad hall too tall to stand under its stair turret, beside a low
  // annex; a nave up the slope over its tower beside an annex: the
  // letters on the top, never on the annex
  expect(
    eave([
      at(100, 20, 1200),
      at(100, 12, 16, { objectIndex: 14 }),
      at(100, 5, 80, { objectIndex: 15 }),
    ])
  ).toBeNull();
  expect(
    eave([
      at(115, 15, 900),
      at(95, 30, 36, { objectIndex: 16 }),
      at(95, 4, 60, { objectIndex: 17 }),
    ])
  ).toBeNull();
  // an ordinary building, tower or not: its letters on the top
  expect(eave([plain(nave), plain(tower)])).toBeNull();
});
