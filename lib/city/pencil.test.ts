import { expect, test } from "bun:test";
import { outlineOf, pencilStroke } from "./pencil";

test("a tree is circled on the ground, wider than its crown", () => {
  const loop = outlineOf([
    { cylinder: { x: 10, z: 5, y0: 100, y1: 103, r: 0.35 } },
    { cylinder: { x: 10, z: 5, y0: 103, y1: 112, r: 3 } },
  ]);
  expect(loop.length).toBeGreaterThanOrEqual(24);
  for (const p of loop) {
    expect(p.y).toBeCloseTo(100.2, 9);
    expect(Math.hypot(p.x - 10, p.z - 5)).toBeCloseTo(3.6, 9);
  }
});

test("a deck's outline follows its measured top, along the railing", () => {
  const loop = outlineOf([
    {
      slab: {
        ring: [
          [0, 0],
          [30, 0],
          [30, 4],
          [0, 4],
          [0, 0],
        ],
        y0: 90,
        y1: 110,
        above: 1,
        below: 1,
        topAt: (x) => 100 + x / 10,
      },
    },
  ]);
  // no segment longer than 1.5 m, every point on the deck
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(a.y).toBeCloseTo(100 + a.x / 10 + 1.6, 9);
  }
});

test("the hand goes round once and a little past, wavering a little", () => {
  const loop = outlineOf([{ cylinder: { x: 0, z: 0, y0: 0, y1: 2, r: 5 } }]);
  const stroke = pencilStroke(loop);
  expect(stroke.length).toBeGreaterThan(loop.length);
  const radii = stroke.map((p) => Math.hypot(p.x, p.z));
  // never far from the circle, and not a perfect one
  expect(Math.min(...radii)).toBeGreaterThan(6 * 0.9);
  expect(Math.max(...radii)).toBeLessThan(6 * 1.12);
  expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05);
  // the same place, the same stroke
  expect(pencilStroke(loop)).toEqual(stroke);
});

test("a deck drawn from its vertex tops is followed edge by edge", () => {
  const loop = outlineOf([
    {
      slab: {
        ring: [
          [0, 0],
          [30, 0],
          [30, 4],
          [0, 4],
        ],
        ringTop: [100, 106, 106, 100],
        y0: 90,
        y1: 110,
        above: 1.3,
        below: 1,
        topAt: () => 0,
      },
    },
  ]);
  for (const p of loop) {
    // linear along each edge, as rail-layer draws it, over the parapet
    expect(p.y).toBeCloseTo(100 + p.x / 5 + 1.6, 9);
  }
});
