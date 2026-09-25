import { expect, test } from "bun:test";
import type { FurnitureFeature } from "./features";
import {
  BENCH_LENGTH,
  BOLLARD_HEIGHT,
  furnitureAreas,
  furniturePieces,
  HOOP_SPACING,
  inRing,
  yawOfBearing,
} from "./furniture";

const at = (
  properties: FurnitureFeature["properties"],
  x = 100,
  y = 200
): FurnitureFeature => ({
  geometry: { type: "Point", coordinates: [x, y] },
  properties,
});

/** Where a yaw turns the model's local +Z front, as (east, north). */
function front(yaw: number): [number, number] {
  // Rotating (0, 0, 1) about +Y by yaw → (sin, 0, cos); north is world −Z.
  return [Math.sin(yaw), -Math.cos(yaw)];
}

test("a bearing turns the model's front to face it", () => {
  const [e0, n0] = front(yawOfBearing(0));
  expect(e0).toBeCloseTo(0);
  expect(n0).toBeCloseTo(1);
  const [e90, n90] = front(yawOfBearing(90));
  expect(e90).toBeCloseTo(1);
  expect(n90).toBeCloseTo(0);
  const [e225, n225] = front(yawOfBearing(225));
  expect(e225).toBeCloseTo(-Math.SQRT1_2);
  expect(n225).toBeCloseTo(-Math.SQRT1_2);
});

test("a bench without a backrest stands as a stool, at its mapped length", () => {
  const [bench, stool] = furniturePieces([
    at({ k: "bench", a: 90 }),
    at({ k: "bench", a: 90, back: false, l: 3.6 }),
  ]);
  expect(bench.model).toBe("bench");
  expect(bench.scaleX).toBe(1);
  expect(stool.model).toBe("stool");
  expect(stool.scaleX).toBeCloseTo(3.6 / BENCH_LENGTH);
});

test("a bicycle stand is a row of hoops along the kerb", () => {
  // Facing north (the street to the north): the row runs east–west.
  const hoops = furniturePieces([at({ k: "bike", a: 0, n: 3 })]);
  expect(hoops).toHaveLength(3);
  expect(hoops.map((h) => h.model)).toEqual(["hoop", "hoop", "hoop"]);
  expect(hoops.map((h) => h.x)).toEqual([
    100 - HOOP_SPACING,
    100,
    100 + HOOP_SPACING,
  ]);
  for (const h of hoops) {
    expect(h.y).toBeCloseTo(200);
  }
});

test("unknown kinds, missing properties and non-points are dropped", () => {
  const pieces = furniturePieces([
    at(null),
    at({ k: "throne" } as unknown as FurnitureFeature["properties"]),
    {
      geometry: { type: "LineString", coordinates: [] },
      properties: { k: "bench" },
    } as unknown as FurnitureFeature,
    at({ k: "bin" }),
  ]);
  expect(pieces.map((p) => p.model)).toEqual(["bin"]);
  expect(Number.isFinite(pieces[0].yaw)).toBe(true);
});

test("a bollard stands at its tagged height; a metal one as a post", () => {
  const [stone, bronze] = furniturePieces([
    at({ k: "bollard" }),
    at({ k: "bollard", h: 1.46, metal: true }),
  ]);
  expect(stone.model).toBe("bollard");
  expect(stone.scaleY).toBe(1);
  expect(bronze.model).toBe("post");
  expect(bronze.scaleY).toBeCloseTo(1.46 / BOLLARD_HEIGHT);
});

test("playgrounds are outlines; only their mapped equipment stands", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const features: FurnitureFeature[] = [
    {
      geometry: { type: "Polygon", coordinates: [square] },
      properties: { k: "playground" },
    },
    at({ k: "swing" }, 5, 5),
    at({ k: "sandpit" }, 2, 2),
  ];
  const areas = furnitureAreas(features);
  expect(areas).toHaveLength(1);
  expect(areas[0].kind).toBe("playground");
  expect(areas[0].ring).toHaveLength(4); // the closing vertex dropped
  expect(inRing(areas[0].ring, 5, 5)).toBe(true);
  expect(inRing(areas[0].ring, 15, 5)).toBe(false);
  expect(furniturePieces(features).map((p) => p.model)).toEqual([
    "swing",
    "sandbox",
  ]);
});
