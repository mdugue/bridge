import { describe, expect, test } from "bun:test";
import {
  designMasks,
  siteFloor,
  convexHull,
  coveredObjects,
  coveredShare,
  inPlan,
  planHull,
  planMask,
} from "./design-cover";

/** A box's triangles (x, y EPSG, z up) from (x0, y0) to (x1, y1), z0 to z1:
 *  its roof and four walls. */
function box(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number
) {
  const quads = [
    // roof
    [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
    // walls
    [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1],
    [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1],
    [x1, y1, z0, x0, y1, z0, x0, y1, z1, x1, y1, z1],
    [x0, y1, z0, x0, y0, z0, x0, y0, z1, x0, y1, z1],
  ];
  const out: number[] = [];
  for (const q of quads) {
    out.push(...q.slice(0, 9), ...q.slice(0, 3), ...q.slice(6, 12));
  }
  return out;
}

const square = (x0: number, y0: number, x1: number, y1: number) => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as [number, number][],
];

describe("design cover", () => {
  test("a box marks its plan, not beyond", () => {
    const mask = planMask(box(0, 0, 10, 20, 100, 110), null);
    expect(mask).not.toBeNull();
    if (!mask) {
      return;
    }
    expect(inPlan(mask, 5, 10)).toBe(true);
    expect(inPlan(mask, 0.5, 0.5)).toBe(true);
    expect(inPlan(mask, 12, 10)).toBe(false);
    expect(inPlan(mask, -1, 10)).toBe(false);
  });

  test("a flat plate at the lowest level is ground, not building", () => {
    const plate = [
      0, 0, 100, 50, 0, 100, 50, 50, 100, 0, 0, 100, 50, 50, 100, 0, 50, 100,
    ];
    const mask = planMask([...plate, ...box(20, 20, 30, 30, 100, 110)], null);
    if (!mask) {
      throw new Error("no plan");
    }
    expect(inPlan(mask, 25, 25)).toBe(true);
    expect(inPlan(mask, 5, 5)).toBe(false);
  });

  test("the site takes the plate too, with the floor it lays, in at most maxSide cells a side", () => {
    // a plate rising 0.4 m eastward over 50 m, a block on it
    const plate = [
      0, 0, 100, 50, 0, 100.4, 50, 50, 100.4, 0, 0, 100, 50, 50, 100.4, 0, 50,
      100,
    ];
    const masks = designMasks(
      [...plate, ...box(20, 20, 30, 30, 101, 110)],
      null,
      undefined,
      { maxSide: 16 }
    );
    if (!masks) {
      throw new Error("no masks");
    }
    const { plan, site } = masks;
    expect(inPlan(plan, 5, 5)).toBe(false);
    expect(inPlan(site, 5, 5)).toBe(true);
    expect(site.cell).toBe(4);
    expect(Math.max(site.cols, site.rows)).toBeLessThanOrEqual(16);
    // the plate's own height under it, not its lowest corner's
    expect(siteFloor(site, 2, 10)).toBeCloseTo(100.0, 1);
    expect(siteFloor(site, 46, 10)).toBeCloseTo(100.38, 1);
    expect(siteFloor(site, 80, 10)).toBeNull();
  });

  test("walls alone mark their lines", () => {
    const walls = box(0, 0, 10, 10, 0, 5).slice(18);
    const mask = planMask(walls, null);
    if (!mask) {
      throw new Error("no plan");
    }
    expect(inPlan(mask, 0.2, 5)).toBe(true);
    expect(inPlan(mask, 5, 5)).toBe(false);
  });

  test("a footprint the plan covers for the most part goes", () => {
    const mask = planMask(box(0, 0, 10, 10, 0, 5), null);
    if (!mask) {
      throw new Error("no plan");
    }
    expect(coveredShare(mask, square(2, 2, 8, 8))).toBe(1);
    // half of it, and the cell the wall at x = 10 marks
    const half = coveredShare(mask, square(5, 0, 15, 10));
    expect(half).toBeGreaterThanOrEqual(0.5);
    expect(half).toBeLessThanOrEqual(0.6);
    expect(coveredShare(mask, square(20, 20, 30, 30))).toBe(0);
    const objects = [
      square(2, 2, 8, 8),
      square(8, 0, 20, 10),
      [],
      square(-30, -30, -20, -20),
    ];
    expect([...coveredObjects(mask, objects)]).toEqual([0]);
  });

  test("a footprint smaller than a cell is asked at its corner", () => {
    const mask = planMask(box(0, 0, 10, 10, 0, 5), null);
    if (!mask) {
      throw new Error("no plan");
    }
    expect(coveredShare(mask, square(4, 4, 4.3, 4.3))).toBe(1);
  });

  test("the hull of the plan and of points", () => {
    const mask = planMask(box(0, 0, 10, 10, 0, 5), null);
    const hull = mask ? planHull(mask) : null;
    expect(hull?.length).toBe(4);
    expect(
      convexHull([
        [0, 0],
        [2, 0],
        [1, 1],
        [2, 2],
        [0, 2],
      ])
    ).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });
});

describe("a placed plan", () => {
  test("the design's own frame turns and moves with its placement", () => {
    // a 10 × 2 m bar along the design's own east (x), 5 m high
    // box() is x, y north, z up: to the design's frame (x, y up, z south)
    const frame: number[] = [];
    const flat = box(-5, -1, 5, 1, 0, 5);
    for (let i = 0; i < flat.length; i += 3) {
      frame.push(flat[i], flat[i + 2], -flat[i + 1]);
    }
    const turned = planMask(frame, null, {
      east: 1000,
      north: 2000,
      base: 100,
      rotation: 90,
    });
    if (!turned) {
      throw new Error("no plan");
    }
    // turned a quarter clockwise, the bar runs north–south
    expect(inPlan(turned, 1000.5, 2004)).toBe(true);
    expect(inPlan(turned, 1004, 2000.5)).toBe(false);
  });
});

describe("designMasks with ground triangles", () => {
  test("a triangle marked ground is in the site but not the plan", () => {
    // a 10 m wall standing up: in the plan unless marked
    const positions = [0, 0, 0, 10, 0, 0, 10, 0, 5, 0, 0, 0, 10, 0, 5, 0, 0, 5];
    const plain = designMasks(positions, null, undefined, { cell: 1 });
    const marked = designMasks(positions, null, undefined, {
      cell: 1,
      ground: [1, 1],
    });
    const count = (cells: Uint8Array) => cells.reduce((s, c) => s + c, 0);
    expect(count(plain?.plan.cells ?? new Uint8Array())).toBeGreaterThan(0);
    expect(count(marked?.plan.cells ?? new Uint8Array())).toBe(0);
    expect(count(marked?.site.cells ?? new Uint8Array())).toBeGreaterThan(0);
  });
});
