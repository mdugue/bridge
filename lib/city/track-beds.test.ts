import { expect, test } from "bun:test";
import { type Bed, BedIndex, burnBeds, tramBed } from "./track-beds";

// a 100 m square grid of 1 m cells, row 0 = north
const n = 100;
const bounds = [0, 0, 100, 100] as const;
const cell = (x: number, y: number) =>
  (n - 1 - Math.floor(y)) * n + Math.floor(x);

/** A line along y = 50 on its profile at 101, its ground laid 0.1 under. */
const bed: Bed = {
  coords: [
    [10, 50],
    [90, 50],
  ],
  z: [101, 101],
  half: 2,
  drop: 0.1,
};

test("the ground under a bed is laid at its profile, its sides at 1 : 1.5", () => {
  const ground = new Float32Array(n * n).fill(99);
  const mask = new Uint8Array(n * n);
  const out = burnBeds({ elevations: ground, n, bounds, beds: [bed], mask });
  expect(out[cell(50, 50)]).toBeCloseTo(100.9, 5);
  expect(mask[cell(50, 50)]).toBe(1);
  // the embankment: 1.5 m beside the bed's edge it has come down 1 m
  expect(out[cell(50, 53.5)]).toBeCloseTo(100.9 - (3.5 - 2) / 1.5, 4);
  // beyond its toe (1.9 m down, 2.85 m out) the ground is as measured
  expect(out[cell(50, 55.5)]).toBe(99);
  expect(mask[cell(50, 53.5)]).toBe(0);
});

test("a bump beside a bed is cut back to the slope, not beyond it", () => {
  const ground = new Float32Array(n * n).fill(103);
  const out = burnBeds({ elevations: ground, n, bounds, beds: [bed] });
  expect(out[cell(50, 50)]).toBeCloseTo(100.9, 5);
  expect(out[cell(50, 53.5)]).toBeCloseTo(100.9 + 1.5 / 1.5, 4);
  // the grading stops BED_SIDE_M past the bed: further out a wall remains
  expect(out[cell(50, 58.5)]).toBe(103);
});

test("a bed's ends are flat and the ground under a deck is never filled", () => {
  const ground = new Float32Array(n * n).fill(95);
  const out = burnBeds({
    elevations: ground,
    n,
    bounds,
    beds: [bed],
    under: (x) => x > 70,
  });
  // past the end: untouched, no ramp into the street under a bridge
  expect(out[cell(93.5, 50)]).toBe(95);
  // on the deck: untouched
  expect(out[cell(80.5, 50)]).toBe(95);
  expect(out[cell(40.5, 50)]).toBeCloseTo(100.9, 5);
  // a DGM that keeps the deck over the line is cut down to the bed
  const kept = new Float32Array(n * n).fill(106);
  const cut = burnBeds({
    elevations: kept,
    n,
    bounds,
    beds: [bed],
    under: (x) => x > 70,
  });
  expect(cut[cell(80.5, 50)]).toBeCloseTo(100.9, 5);
});

test("under two beds the nearest wins", () => {
  const ground = new Float32Array(n * n).fill(100);
  const other: Bed = {
    ...bed,
    coords: [
      [10, 54],
      [90, 54],
    ],
    z: [102, 102],
  };
  const out = burnBeds({ elevations: ground, n, bounds, beds: [bed, other] });
  expect(out[cell(50, 51.5)]).toBeCloseTo(100.9, 5);
  expect(out[cell(50, 52.5)]).toBeCloseTo(101.9, 5);
});

test("the bed index answers the profile, not the ground under it", () => {
  const index = new BedIndex([bed], 2);
  expect(index.levelAt(50, 51)).toBeCloseTo(101, 6);
  expect(index.levelAt(50, 60)).toBeNull();
  expect(tramBed("street").drop).toBeLessThan(0.05);
});

test("a bed on a deck only lowers the ground: a bridge the DGM kept is cut", () => {
  const onDeck: Bed = { ...bed, lowerOnly: true };
  const street = new Float32Array(n * n).fill(95);
  const low = burnBeds({ elevations: street, n, bounds, beds: [onDeck] });
  expect(low[cell(50.5, 50.5)]).toBe(95);
  const kept = new Float32Array(n * n).fill(102);
  const mask = new Uint8Array(n * n);
  const cut = burnBeds({ elevations: kept, n, bounds, beds: [onDeck], mask });
  expect(cut[cell(50.5, 50.5)]).toBeCloseTo(100.9, 5);
  expect(mask[cell(50.5, 50.5)]).toBe(1);
});

test("a cut's bed opens a shallow trench, never a tunnel's lid", () => {
  const inCut: Bed = { ...bed, shallow: 0.5 };
  // the ground 0.3 m over the profile: lowered to the bed
  const near = new Float32Array(n * n).fill(101.3);
  const trench = burnBeds({ elevations: near, n, bounds, beds: [inCut] });
  expect(trench[cell(50.5, 50.5)]).toBeCloseTo(100.9, 5);
  // 3 m over it: the line runs under a lid, the ground stays
  const deep = new Float32Array(n * n).fill(104);
  const lid = burnBeds({ elevations: deep, n, bounds, beds: [inCut] });
  expect(lid[cell(50.5, 50.5)]).toBe(104);
  // below it: never raised
  const low = new Float32Array(n * n).fill(99);
  const kept = burnBeds({ elevations: low, n, bounds, beds: [inCut] });
  expect(kept[cell(50.5, 50.5)]).toBe(99);
});
