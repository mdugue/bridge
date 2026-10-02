import { expect, test } from "bun:test";
import {
  factColumns,
  inheritedOsm,
  isoDate,
  lod2Facts,
  MEASURED_ROOF,
  NO_FACT,
  readFacts,
  ringsArea,
  scanFacts,
  treeFacts,
  unionArea,
} from "./object-facts";

const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 5],
  [0, 5],
];

test("ring areas count positive whatever the winding", () => {
  expect(ringsArea([square])).toBe(50);
  expect(ringsArea([[...square].reverse(), square])).toBe(100);
  expect(ringsArea([])).toBe(0);
});

const shifted = (dx: number, dy: number): [number, number][] =>
  square.map(([x, y]) => [x + dx, y + dy]);

test("a union of footprints counts an overlap once", () => {
  expect(unionArea([square])).toBeCloseTo(50, 6);
  // half of the second square lies on the first: 50 + 25
  expect(unionArea([square, shifted(5, 0)])).toBeCloseTo(75, 6);
  // a part on top of the other (the same ground) adds nothing
  expect(unionArea([square, square])).toBeCloseTo(50, 6);
  // apart, they add up; a triangle within a scanline step of exact
  expect(unionArea([square, shifted(20, 0)])).toBeCloseTo(100, 6);
  const triangle: [number, number][] = [
    [0, 0],
    [10, 0],
    [0, 10],
  ];
  expect(unionArea([triangle])).toBeCloseTo(50, 1);
  expect(unionArea([])).toBe(0);
});

test("a Building answers for its tree: union ground, base to top", () => {
  const root = lod2Facts({
    buildingId: "B",
    fallbackHeight: 0,
    footprints: [],
    own: {},
    resolved: {},
  });
  const tree = [
    { baseZ: 100, topZ: 110, footprints: [square] },
    // a tower on the podium
    { baseZ: 110, topZ: 140, footprints: [shifted(5, 0)] },
  ];
  const facts = treeFacts(root, tree, false);
  expect(facts.area).toBe(75);
  expect(facts.height).toBe(40);
  // what the survey measured for the Building itself stays
  const surveyed = treeFacts({ ...root, height: 38.5 }, tree, true);
  expect(surveyed.height).toBe(38.5);
  expect(surveyed.area).toBe(75);
});

test("dates lose their clock; anything else is no date", () => {
  expect(isoDate("2025-07-04T00:00:00Z")).toBe("2025-07-04");
  expect(isoDate("2023-04-26")).toBe("2023-04-26");
  expect(isoDate("yesterday")).toBe("");
  expect(isoDate(20_250_704)).toBe("");
});

test("LoD2 facts: the survey's height, else the model's; rounded", () => {
  const base = {
    buildingId: "DESNATPU1000HJx5",
    footprints: [square],
    own: {},
    resolved: {},
  };
  expect(
    lod2Facts({
      ...base,
      fallbackHeight: 12.3456,
      own: { measuredHeight: 18.077 },
    }).height
  ).toBe(18.08);
  expect(lod2Facts({ ...base, fallbackHeight: 12.3456 }).height).toBe(12.35);
  expect(lod2Facts({ ...base, fallbackHeight: 0 }).height).toBe(NO_FACT);
  const f = lod2Facts({
    ...base,
    fallbackHeight: 5,
    own: {
      roofType: "3100",
      Dachneigung: 19.912,
      creationDate: "2025-07-04T00:00:00Z",
    },
    resolved: { function: "31001_3041" },
    osm: { name: "Kreuzkirche", addr: "An der Kreuzkirche 6", levels: 3 },
  });
  expect(f).toEqual({
    buildingId: "DESNATPU1000HJx5",
    function: "31001_3041",
    roofType: "3100",
    created: "2025-07-04",
    name: "Kreuzkirche",
    addr: "An der Kreuzkirche 6",
    height: 5,
    roofPitch: 19.9,
    area: 50,
    levels: 3,
  });
});

test("a scan structure knows its id, height and ground only", () => {
  expect(
    scanFacts({ id: "scan:t:1:2", footprint: square, height: 2.456 })
  ).toEqual({
    buildingId: "scan:t:1:2",
    function: "",
    roofType: "",
    created: "",
    name: "",
    addr: "",
    height: 2.46,
    roofPitch: NO_FACT,
    area: 50,
    levels: NO_FACT,
  });
});

test("a part's OSM facts: its own over its Building's", () => {
  expect(inheritedOsm(undefined, undefined)).toBeUndefined();
  expect(
    inheritedOsm({ shop: 1 }, { name: "Altmarkt-Galerie", shop: 0 })
  ).toEqual({
    name: "Altmarkt-Galerie",
    shop: 1,
  });
});

test("fact columns round-trip through a table reader", () => {
  const facts = [
    scanFacts({ id: "scan:t:1:2", footprint: square, height: 3 }),
    undefined,
  ];
  const { strings, enums, numbers } = factColumns(facts);
  expect(strings.buildingId).toEqual(["scan:t:1:2", "#1"]);
  expect(enums.function).toEqual(["", ""]);
  expect([...numbers.height]).toEqual([3, NO_FACT]);
  const row = (i: number) => (column: string) =>
    column in numbers
      ? numbers[column as keyof typeof numbers][i]
      : column in strings
        ? strings[column as keyof typeof strings][i]
        : enums[column as keyof typeof enums][i];
  expect(readFacts(row(0), "#0")).toEqual(
    facts[0] as NonNullable<(typeof facts)[0]>
  );
});

test("reading a tile that predates the fact columns yields unknowns", () => {
  const f = readFacts(() => undefined, "#7");
  expect(f.buildingId).toBe("#7");
  expect(f.height).toBe(NO_FACT);
  expect(f.function).toBe("");
  // 0 from a reader is a value (a flat roof), negative or NaN is not.
  expect(
    readFacts((c) => (c === "roofPitch" ? 0 : Number.NaN), "#1").roofPitch
  ).toBe(0);
  expect(readFacts(() => Number.NaN, "#1").height).toBe(NO_FACT);
});

test("a roof rebuilt from the surface model drops the LoD2's form, pitch, height", () => {
  const facts = lod2Facts({
    buildingId: "B",
    fallbackHeight: 19.2,
    footprints: [square],
    // a new block the LoD2 still holds as a 3 m placeholder
    own: { measuredHeight: 3, roofType: "1000", Dachneigung: 0 },
    resolved: {},
    rebuilt: true,
  });
  expect(facts.roofType).toBe(MEASURED_ROOF);
  expect(facts.roofPitch).toBe(NO_FACT);
  expect(facts.height).toBe(19.2);
});
