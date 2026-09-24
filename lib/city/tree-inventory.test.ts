import { expect, test } from "bun:test";
import {
  ARCHETYPE_SHAPE,
  archetypeOf,
  FOOTPRINT_CELL,
  footprintIndex,
  footprintRadius,
  MIN_FOOTPRINT_R,
  overtops,
  TREE_ARCHETYPES,
  treeExtents,
} from "./tree-inventory";

test("archetype ids follow the bake's order and fall back to round", () => {
  expect(TREE_ARCHETYPES[2]).toBe("columnar");
  expect(archetypeOf(3)).toBe("conifer");
  expect(archetypeOf(undefined)).toBe("round");
  expect(archetypeOf(99)).toBe("round");
  // Proportion-only archetypes share the broadleaf crown.
  expect(ARCHETYPE_SHAPE.oval).toBe("broad");
  expect(ARCHETYPE_SHAPE.small).toBe("broad");
  expect(ARCHETYPE_SHAPE.columnar).toBe("spindle");
});

test("extents: the crown spans clear stem to the top, the trunk reaches into it", () => {
  const e = treeExtents(20, 12, "round");
  expect(e.crownTop).toBe(20);
  expect(e.crownWidth).toBe(12);
  expect(e.crownBase).toBeCloseTo(6.6);
  expect(e.trunkTop).toBeGreaterThan(e.crownBase);
  expect(e.trunkTop).toBeLessThan(e.crownTop);
  // A columnar tree keeps its crown low; a globe cultivar is a ball on a stem.
  expect(treeExtents(15, 4, "columnar").crownBase).toBeLessThan(3);
  expect(treeExtents(6, 4, "small", true).crownBase).toBeCloseTo(2.7);
});

test("extents never carry NaN or absurd sizes into a matrix", () => {
  const e = treeExtents(Number.NaN, Number.NaN, "oval");
  for (const v of Object.values(e)) {
    expect(Number.isFinite(v)).toBe(true);
  }
  expect(treeExtents(90, 126, "round").crownWidth).toBe(30);
  expect(treeExtents(0.2, 0.1, "round").crownTop).toBe(1.5);
});

test("footprint radius: half the crown, floored at half the canopy grid, capped at a cell", () => {
  expect(footprintRadius(12)).toBe(6);
  expect(footprintRadius(2)).toBe(MIN_FOOTPRINT_R);
  expect(footprintRadius(60)).toBe(FOOTPRINT_CELL);
  expect(footprintRadius(Number.NaN)).toBe(MIN_FOOTPRINT_R);
});

test("footprintIndex covers each tree's radius, across cell borders", () => {
  const covers = footprintIndex([
    { x: 1000, y: 2000, r: 5, h: 10 },
    { x: 1015.9, y: 2000, r: 16, h: 10 },
  ]);
  expect(covers(1004, 2000)).toBe(true);
  expect(covers(1000, 2006)).toBe(false);
  // the second tree sits at a cell edge; its radius reaches two cells over
  expect(covers(1031, 2000)).toBe(true);
  expect(covers(1033, 2000)).toBe(false);
  expect(footprintIndex([])(0, 0)).toBe(false);
});

test("a canopy point clearly taller than the inventory tree is another tree", () => {
  const covers = footprintIndex([{ x: 0, y: 0, r: 5, h: 6 }]);
  expect(covers(1, 0, 9)).toBe(true); // within max(5 m, 30 %)
  expect(covers(1, 0, 12)).toBe(false); // a big park tree over a young one
  expect(covers(1, 0)).toBe(true); // rows carry no height
  expect(overtops(30, 20)).toBe(true);
  expect(overtops(25, 20)).toBe(false);
});
