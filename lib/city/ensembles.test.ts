import { expect, test } from "bun:test";
import { ensembleGroup, ensembleRoots, footprintsTouch } from "./ensembles";

const square = (x: number, y: number, s = 10): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

test("footprints touch along a shared wall, across a hair's gap, or inside one another", () => {
  expect(footprintsTouch([square(0, 0)], [square(10, 0)])).toBe(true);
  expect(footprintsTouch([square(0, 0)], [square(10.3, 0)])).toBe(true);
  expect(footprintsTouch([square(0, 0)], [square(3, 3, 2)])).toBe(true);
  expect(footprintsTouch([square(0, 0)], [square(12, 0)])).toBe(false);
  // a plus: two long wings crossing, no vertex of one inside the other
  const long: [number, number][] = [
    [-10, 4],
    [20, 4],
    [20, 6],
    [-10, 6],
  ];
  const tall: [number, number][] = [
    [4, -10],
    [6, -10],
    [6, 20],
    [4, 20],
  ];
  expect(footprintsTouch([long], [tall])).toBe(true);
});

test("named trees that touch join under their lowest root; others stay alone", () => {
  const lead = ensembleRoots([
    // the Residenzschloss: the complex and the tower against it
    { root: 4, name: "Residenzschloss", outline: "", rings: [square(0, 0)] },
    { root: 1, name: "Residenzschloss", outline: "", rings: [square(10, 0)] },
    // same name, a street away
    { root: 7, name: "Residenzschloss", outline: "", rings: [square(40, 0)] },
    // a terrace: touching, but unnamed
    { root: 9, name: "", outline: "", rings: [square(0, 10)] },
    { root: 12, name: "", outline: "", rings: [square(10, 10)] },
    // touching, another name
    {
      root: 15,
      name: "Taschenbergpalais",
      outline: "",
      rings: [square(20, 0)],
    },
  ]);
  expect(Object.fromEntries(lead)).toEqual({
    1: 1,
    4: 1,
    7: 7,
    9: 9,
    12: 12,
    15: 15,
  });
});

test("a row of named wings is one ensemble, joined through its middle", () => {
  const lead = ensembleRoots([
    { root: 3, name: "Zwinger", outline: "", rings: [square(0, 0)] },
    { root: 2, name: "Zwinger", outline: "", rings: [square(20, 0)] },
    { root: 5, name: "Zwinger", outline: "", rings: [square(10, 0)] },
  ]);
  expect([...lead.values()]).toEqual([2, 2, 2]);
});

test("trees under one OSM outline join wherever they stand; two outlines keep a shared name apart", () => {
  const lead = ensembleRoots([
    // the tower and the complex: one outline
    { root: 5, name: "", outline: "r5764", rings: [square(0, 0)] },
    { root: 8, name: "Schloss", outline: "r5764", rings: [square(50, 0)] },
    // two halls named alike, side by side, two outlines
    { root: 10, name: "Sporthalle", outline: "w1", rings: [square(0, 20)] },
    { root: 11, name: "Sporthalle", outline: "w2", rings: [square(10, 20)] },
    // a wing OSM's outline misses, beside its named neighbour
    { root: 12, name: "Aldi", outline: "w3", rings: [square(0, 40)] },
    { root: 13, name: "Aldi", outline: "", rings: [square(10, 40)] },
  ]);
  expect(Object.fromEntries(lead)).toEqual({
    5: 5,
    8: 5,
    10: 10,
    11: 11,
    12: 12,
    13: 12,
  });
});

test("an ensemble's group is its outline's, never 0 for one", () => {
  expect(ensembleGroup("")).toBe(0);
  expect(ensembleGroup("r5764")).toBe(ensembleGroup("r5764"));
  expect(ensembleGroup("r5764")).not.toBe(ensembleGroup("w5764"));
  expect(ensembleGroup("r5764")).toBeGreaterThan(0);
});
