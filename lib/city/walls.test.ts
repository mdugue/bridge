import { expect, test } from "bun:test";
import { type WallRibbon, wallGeometry } from "./walls";

const offset = { cx: 0, cy: 0 };
const flat = () => 100;

const line = (h: number): WallRibbon => ({
  coords: [
    [0, 0],
    [10, 0],
  ],
  h,
});

test("a wall becomes one ribbon: a quad (two triangles) per densified segment", () => {
  // 10 m at 2.5 m spacing → 5 columns → 4 quads → 24 vertices.
  expect(wallGeometry([line(3)], flat, offset)?.positions.length).toBe(
    4 * 6 * 3
  );
});

test("kerb-height walls and empty inputs build nothing", () => {
  expect(wallGeometry([], flat, offset)).toBeNull();
  expect(wallGeometry([line(0.5)], flat, offset)).toBeNull();
});

test("a wall off the ground is skipped, not thrown", () => {
  expect(wallGeometry([line(3)], () => null, offset)).toBeNull();
});

test("a wall on a step stands from the low shelf to the high one", () => {
  // Ground 100 m south of y = 0, 108 m north of it: a wall along y = 0.
  const step = (_x: number, y: number) => (y > 0 ? 108 : 100);
  const g = wallGeometry([line(3)], step, offset);
  const ys = (g?.positions ?? []).filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys)).toBe(108);
  expect(Math.min(...ys)).toBeCloseTo(99.6, 5); // the low shelf, 0.4 m dip
});

test("a snapped wall's cap runs back to where the ground reaches its level", () => {
  // A retaining wall along y = 0, the high shelf north: a ramp from 100 m
  // to 108 m between y = −0.5 and y = 1.5 (the DGM's blur), except around
  // x = 5, where it runs on to y = 3.5 (wider there than the median).
  const wide = (x: number) => (Math.abs(x - 5) < 1.5 ? 3.5 : 1.5);
  const ramp = (x: number, y: number) => {
    const top = wide(x);
    const t = Math.min(Math.max((y + 0.5) / (top + 0.5), 0), 1);
    return 100 + 8 * t;
  };
  const wall: WallRibbon = {
    coords: [
      [-20, 0],
      [30, 0],
    ],
    h: 8,
    kind: "retaining_wall",
  };
  const g = wallGeometry([wall], ramp, offset, { snapToStep: true });
  const pos = g?.positions ?? [];
  // the cap's back edge (world z = −north) at the columns near x = 5 and far
  // from it
  const capBack = (x: number) => {
    let north = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i] - x) < 0.01 && Math.abs(pos[i + 1] - 108) < 0.01) {
        north = Math.max(north, -pos[i + 2]);
      }
    }
    return north;
  };
  // where the ramp ends, the ground is at the cap: the cap reaches it
  expect(capBack(5)).toBeGreaterThanOrEqual(3.5);
  expect(capBack(-15)).toBeGreaterThanOrEqual(1.5);
  expect(capBack(-15)).toBeLessThan(3);
});
