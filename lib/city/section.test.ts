import { describe, expect, test } from "bun:test";
import { modelFootprint, type ModelView, withPreset } from "./model-view";
import {
  cutOutCorners,
  cutOutFromView,
  cutOutPlanes,
  groundStrip,
  insideCutOut,
  joinStrips,
  sectionLine,
} from "./section";

const VIEWPORT = { width: 1000, height: 700 };

function view(preset: "iso" | "plan" | "section", turnDeg = 0): ModelView {
  return withPreset(
    {
      pivot: { x: 100, y: 110, z: -50 },
      preset,
      turnDeg,
      tiltDeg: 0,
      metresPerPixel: 0.5,
      shear: 0,
      cut: false,
    },
    preset
  );
}

describe("groundStrip", () => {
  test("a wall from the ground down to the base, two triangles a step", () => {
    const strip = groundStrip(
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      1,
      (x) => 100 + x,
      80
    );
    expect(strip.positions.length).toBe(11 * 2 * 3);
    expect(strip.index.length).toBe(10 * 6);
    // the first sample's top and bottom
    expect(Array.from(strip.positions.slice(0, 6))).toEqual([
      0, 100, 0, 0, 80, 0,
    ]);
  });

  test("breaks where the ground is unknown, never inventing a height", () => {
    const strip = groundStrip(
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      1,
      (x) => (x > 3 && x < 7 ? null : 100),
      80
    );
    // samples 0..3 and 7..10: two runs of four, three quads each
    expect(strip.positions.length).toBe(8 * 2 * 3);
    expect(strip.index.length).toBe(6 * 6);
  });

  test("the base is always below the ground", () => {
    const strip = groundStrip({ x: 0, z: 0 }, { x: 1, z: 0 }, 1, () => 50, 80);
    expect(strip.positions[4]).toBeLessThan(50);
  });
});

test("joinStrips offsets each strip's indices", () => {
  const a = groundStrip({ x: 0, z: 0 }, { x: 1, z: 0 }, 1, () => 1, 0);
  const b = groundStrip({ x: 5, z: 0 }, { x: 6, z: 0 }, 1, () => 1, 0);
  const joined = joinStrips([a, b]);
  expect(joined.positions.length).toBe(a.positions.length + b.positions.length);
  expect(Math.max(...joined.index)).toBe(joined.positions.length / 3 - 1);
});

test("sectionLine runs across the picture through the pivot, just behind it", () => {
  const v = view("section", 90);
  const { from, to } = sectionLine(v, 200);
  // looking east: the line runs north–south, a hair east of the pivot
  expect(Math.abs(from.x - to.x)).toBeLessThan(1e-9);
  expect(from.x).toBeGreaterThan(v.pivot.x);
  expect(Math.abs(to.z - from.z)).toBeCloseTo(440, 6);
});

describe("the cut-out", () => {
  test("from a plan view: a north-aligned square inside the picture", () => {
    const v = view("plan");
    const cut = cutOutFromView(v, VIEWPORT);
    expect(cut.centre).toEqual({ x: 100, z: -50 });
    expect(cut.turnDeg).toBe(0);
    // the plan shows 500 × 350 m: the largest square is 350 m across
    expect(cut.halfRight).toBeCloseTo(175 * 0.8, 3);
    expect(cut.halfAhead).toBe(cut.halfRight);
  });

  test("from an isometry: still north-aligned, and inside what it shows", () => {
    const v = view("iso", 45);
    const cut = cutOutFromView(v, VIEWPORT);
    expect(cut.turnDeg).toBe(0);
    const foot = modelFootprint(v, VIEWPORT);
    const minX = Math.min(...foot.map((p) => p.x));
    const maxX = Math.max(...foot.map((p) => p.x));
    for (const c of cutOutCorners(cut)) {
      expect(c.x).toBeGreaterThan(minX);
      expect(c.x).toBeLessThan(maxX);
    }
  });

  test("its planes keep the inside and its corners lie on them", () => {
    const cut = cutOutFromView(view("iso", 45), VIEWPORT);
    expect(insideCutOut(cut, cut.centre)).toBe(true);
    for (const c of cutOutCorners(cut)) {
      expect(insideCutOut(cut, c)).toBe(true);
      const far = {
        x: cut.centre.x + (c.x - cut.centre.x) * 1.05,
        z: cut.centre.z + (c.z - cut.centre.z) * 1.05,
      };
      expect(insideCutOut(cut, far)).toBe(false);
    }
    expect(cutOutPlanes(cut)).toHaveLength(4);
  });
});
