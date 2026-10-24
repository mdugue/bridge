import { describe, expect, test } from "bun:test";
import type { CanopyFeature, VegRowFeature } from "./features";
import {
  BASE_TREE_H,
  CARRIAGEWAY_CLEARANCE_M,
  CROWN_TO_HEIGHT,
  canopyCrownWidth,
  canopyPlacements,
  crownBase,
  GENERIC_CROWN_W,
  plantedRows,
  rowPlacements,
} from "./tree-placement";

const ctx = { heightAt: () => 100, offset: { cx: 0, cy: 0 } };

function point(h: number, r?: number): CanopyFeature {
  return {
    geometry: { type: "Point", coordinates: [10, 20] },
    properties: r === undefined ? { h } : ({ h, r } as { h: number }),
  };
}

describe("canopy placements", () => {
  test("a canopy tree stands as tall as measured, 0.58 of it wide", () => {
    const [p] = canopyPlacements([point(20)], ctx);
    const height = p.s * BASE_TREE_H;
    const width = (p.w ?? p.s) * GENERIC_CROWN_W;
    // ± the 10 % jitter on each
    expect(height).toBeGreaterThan(18);
    expect(height).toBeLessThan(22);
    expect(width / height).toBeGreaterThan(CROWN_TO_HEIGHT * 0.9 * 0.9);
    expect(width / height).toBeLessThan(CROWN_TO_HEIGHT * 1.1 * 1.1);
  });

  test("an evergreen crown is marked, a broadleaf one is not", () => {
    const needle: CanopyFeature = {
      geometry: { type: "Point", coordinates: [10, 20] },
      properties: { h: 20, l: "e" },
    };
    const [conifer, broadleaf] = canopyPlacements([needle, point(20)], ctx);
    expect(conifer.evergreen).toBe(true);
    expect(broadleaf.evergreen).toBeUndefined();
  });

  test("a laser-scan crown takes its measured radius, within bounds", () => {
    expect(canopyCrownWidth(20, 5, 0.5)).toBeCloseTo(10);
    // a 1 m radius on a 20 m tree is the peak's knob, not its crown
    expect(canopyCrownWidth(20, 1, 0.5)).toBeCloseTo(8);
    // a group's radius is not one tree's crown
    expect(canopyCrownWidth(20, 12, 0.5)).toBeCloseTo(15);
    expect(canopyCrownWidth(20, undefined, 0.5)).toBeCloseTo(
      20 * CROWN_TO_HEIGHT
    );
  });
});

describe("the crown's base", () => {
  test("starts at 0.15 + 0.012 · H of the height, within 0.22–0.6", () => {
    expect(crownBase(10)).toBeCloseTo(2.7);
    expect(crownBase(30)).toBeCloseTo(15.3);
    // a small tree at the clamp's foot, a giant at its top
    expect(crownBase(5)).toBeCloseTo(1.1);
    expect(crownBase(40)).toBeCloseTo(24);
  });

  test("over a carriageway it clears the traffic, up to the clamp's top", () => {
    expect(crownBase(8, true)).toBeCloseTo(CARRIAGEWAY_CLEARANCE_M);
    expect(crownBase(4, true)).toBeCloseTo(2.4);
    // a tall tree's own base is higher already
    expect(crownBase(20, true)).toBeCloseTo(crownBase(20));
  });

  test("a canopy tree carries it from its drawn height and its flag", () => {
    const over: CanopyFeature = {
      geometry: { type: "Point", coordinates: [10, 20] },
      properties: { h: 8, c: 1 },
    };
    const [street, park] = canopyPlacements([over, point(8)], ctx);
    expect(street.base).toBeCloseTo(CARRIAGEWAY_CLEARANCE_M);
    expect(park.base).toBeCloseTo(crownBase(park.s * BASE_TREE_H));
  });
});

describe("the rows the layer plants", () => {
  const line = (kind: "hedge" | "treerow"): VegRowFeature => ({
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [30, 0],
      ],
    },
    properties: { kind },
  });

  test("a tile with a canopy plants its hedges only (its rows' trees are the canopy's)", () => {
    const rows = [line("hedge"), line("treerow")];
    expect(plantedRows(rows, true)).toEqual([rows[0]]);
    expect(plantedRows(rows, false)).toEqual(rows);
  });

  test("a grid row tree starts its crown at its base, a hedge has none", () => {
    const { trees, hedges } = rowPlacements(
      [line("treerow"), line("hedge")],
      ctx
    );
    expect(trees.length).toBeGreaterThan(0);
    expect(hedges.length).toBeGreaterThan(0);
    for (const t of trees) {
      expect(t.base).toBeCloseTo(crownBase(t.s * BASE_TREE_H));
    }
    expect(hedges.every((h) => h.base === undefined)).toBe(true);
  });
});
