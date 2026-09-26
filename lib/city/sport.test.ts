import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  packSportTable,
  SPORT_MARKINGS,
  SPORT_ROW_FLOATS,
  SPORT_SHAPES,
  SPORT_SURFACES,
  sportCode,
  sportField,
  sportFixtures,
  sportMarkingId,
  sportShapeId,
  sportSurfaceId,
  type SportTable,
} from "./sport";

interface CommittedTable extends SportTable {
  markings: Record<string, string>;
  shapes: Record<string, string>;
  surfaces: Record<string, string>;
}

const committed = readdirSync("data/dlm")
  .filter((f) => /^sport_.*\.json$/u.test(f))
  .map(
    (f) => JSON.parse(readFileSync(`data/dlm/${f}`, "utf8")) as CommittedTable
  );

const asMap = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((k, i) => [String(i), k]));

test("the ids are the bake's, in every committed table", () => {
  expect(committed.length).toBeGreaterThan(0);
  for (const table of committed) {
    expect(table.surfaces).toEqual(asMap(SPORT_SURFACES.map((s) => s.key)));
    expect(table.markings).toEqual(asMap(SPORT_MARKINGS));
    expect(table.shapes).toEqual(asMap(SPORT_SHAPES));
  }
});

test("every committed row is a known, finite ground on its tile", () => {
  for (const { grounds } of committed) {
    expect(grounds.length).toBeLessThanOrEqual(255);
    for (const row of grounds) {
      expect(row).toHaveLength(9);
      expect(row.every(Number.isFinite)).toBe(true);
      const [, , , p1, p2, p3, surface, marking, shape] = row;
      expect(surface).toBeLessThan(SPORT_SURFACES.length);
      expect(marking).toBeLessThan(SPORT_MARKINGS.length);
      expect(shape).toBeLessThan(SPORT_SHAPES.length);
      expect(p1).toBeGreaterThan(0);
      expect(p2).toBeGreaterThan(0);
      if (shape === sportShapeId("stadium")) {
        expect(p3).toBeGreaterThan(0);
        expect(p3).toBeLessThanOrEqual(p2);
      }
    }
  }
});

test("the surfaces are pastel: light, and never the loud real colours", () => {
  for (const { srgb } of SPORT_SURFACES) {
    if (srgb) {
      const lightness = (Math.max(...srgb) + Math.min(...srgb)) / 2;
      const spread = Math.max(...srgb) - Math.min(...srgb);
      expect(lightness).toBeGreaterThan(150);
      expect(spread).toBeLessThan(95);
    }
  }
  expect(SPORT_SURFACES[sportSurfaceId("ground")].srgb).toBeNull();
});

test("a row packs into two texels: the frame, then the shape and the code", () => {
  const code = sportCode(
    sportSurfaceId("clay"),
    sportMarkingId("tennis"),
    sportShapeId("rect")
  );
  const { data, width } = packSportTable({
    grounds: [
      [10, -20, 0, 18, 9, 0, 4, 2, 0],
      [5, -5, Math.PI / 2, 40, 36, 7, 3, 6, 1],
    ],
  });
  expect(width).toBe(2);
  expect(data).toHaveLength(2 * SPORT_ROW_FLOATS);
  expect([...data.subarray(0, 4)]).toEqual([10, -20, 1, 0]);
  expect(data[4]).toBe(5);
  expect(data[6]).toBeCloseTo(0, 6);
  expect(data[7]).toBeCloseTo(1, 6);
  expect([...data.subarray(8, 12)]).toEqual([18, 9, 0, code]);
  expect(data[15]).toBe(sportCode(3, 6, 1));
});

test("a row with an id the viewer does not know draws nothing", () => {
  const { data } = packSportTable({
    grounds: [[0, 0, 0, 5, 5, 0, 99, 1, 0]],
  });
  expect(data[7]).toBe(0);
});

test("a football pitch gets a goal on each goal line, facing in", () => {
  const [fx] = sportField(55, 35);
  const [a, b] = sportFixtures({
    grounds: [[100, -100, Math.PI / 2, 55, 35, 0, 1, 1, 0]],
  });
  expect(a.kind).toBe("goal");
  expect(a.x).toBeCloseTo(100, 6);
  expect(a.y).toBeCloseTo(-100 + fx, 6);
  expect(a.angle).toBeCloseTo(Math.PI * 1.5, 6);
  expect(b.y).toBeCloseTo(-100 - fx, 6);
  expect(b.angle).toBeCloseTo(Math.PI / 2, 6);
  expect(a.width).toBeGreaterThan(7.2);
  expect(a.height).toBeCloseTo(2.44, 2);
});

test("a small pitch gets small goals, never under 3 m", () => {
  const [goal] = sportFixtures({
    grounds: [[0, 0, 0, 12, 7, 0, 1, 1, 0]],
  });
  expect(goal.width).toBe(3);
  expect(goal.height).toBe(2);
});

test("courts get their nets and posts; tracks and free shapes nothing", () => {
  const out = sportFixtures({
    grounds: [
      [0, 0, 0, 18, 9, 0, 4, 2, 0], // tennis
      [50, 0, 0, 9, 8, 0, 6, 3, 0], // a basketball half court
      [90, 0, 0, 16, 9, 0, 6, 3, 0], // a full court
      [0, 50, 0, 9, 5, 0, 5, 4, 0], // beach volleyball
      [0, 90, 0, 40, 36, 7, 3, 6, 1], // a track
      [0, 99, 0, 30, 20, 0, 1, 1, 2], // a free outline
    ],
  });
  expect(out.map((f) => f.kind)).toEqual([
    "net",
    "hoop",
    "hoop",
    "hoop",
    "net",
  ]);
  expect(out[0].width).toBeCloseTo(2 * (5.485 + 0.914), 6);
  expect(out[0].height).toBe(1.07);
  expect(out[4].height).toBe(2.43);
});
