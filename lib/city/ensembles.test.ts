import { expect, test } from "bun:test";
import { ensembleRoots, footprintsTouch } from "./ensembles";

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
});

test("named trees that touch join under their lowest root; others stay alone", () => {
  const lead = ensembleRoots([
    // the Residenzschloss: the complex and the tower against it
    { root: 4, name: "Residenzschloss", rings: [square(0, 0)] },
    { root: 1, name: "Residenzschloss", rings: [square(10, 0)] },
    // same name, a street away
    { root: 7, name: "Residenzschloss", rings: [square(40, 0)] },
    // a terrace: touching, but unnamed
    { root: 9, name: "", rings: [square(0, 10)] },
    { root: 12, name: "", rings: [square(10, 10)] },
    // touching, another name
    { root: 15, name: "Taschenbergpalais", rings: [square(20, 0)] },
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
    { root: 3, name: "Zwinger", rings: [square(0, 0)] },
    { root: 2, name: "Zwinger", rings: [square(20, 0)] },
    { root: 5, name: "Zwinger", rings: [square(10, 0)] },
  ]);
  expect([...lead.values()]).toEqual([2, 2, 2]);
});
