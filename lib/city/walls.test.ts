import { expect, test } from "bun:test";
import {
  linearTone,
  MASONRY,
  masonryOf,
  WALL_TONES,
  type WallRibbon,
  wallColors,
  wallGeometry,
} from "./walls";

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
  expect(wallGeometry([line(0.25)], flat, offset)).toBeNull();
  // a low garden wall the surface model measured still stands
  expect(wallGeometry([line(0.5)], flat, offset)).not.toBeNull();
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

test("a freestanding wall on level ground rises its height above it, on its line", () => {
  // A 1.5 m garden wall along y = 0: the high-shelf rule ended it at the
  // ground; it stands from the ground up, 0.4 m thick around its OSM line.
  const wall: WallRibbon = { ...line(1.5), kind: "wall" };
  const pos = wallGeometry([wall], flat, offset)?.positions ?? [];
  const ys = pos.filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys)).toBeCloseTo(101.5, 5);
  expect(Math.min(...ys)).toBeLessThan(100);
  const zs = pos.filter((_, i) => i % 3 === 2);
  expect(Math.min(...zs)).toBeCloseTo(-0.2, 5); // both faces, either side
  expect(Math.max(...zs)).toBeCloseTo(0.2, 5);
});

test("a freestanding wall on a step taller than itself ends at the high shelf", () => {
  const step = (_x: number, y: number) => (y > 0 ? 108 : 100);
  const wall: WallRibbon = { ...line(1.5), kind: "wall" };
  const ys = (wallGeometry([wall], step, offset)?.positions ?? []).filter(
    (_, i) => i % 3 === 1
  );
  expect(Math.max(...ys)).toBe(108);
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

test("a snapped wall's cap faces up whichever side its high shelf is on", () => {
  // The same retaining wall twice, its high shelf north and then south of
  // the line: the walls draw both sides, so a cap wound downwards is shaded
  // from below.
  for (const north of [true, false]) {
    const ramp = (_x: number, y: number) => {
      const t = Math.min(Math.max((y + 0.5) / 2, 0), 1);
      return 100 + 8 * (north ? t : 1 - t);
    };
    const wall: WallRibbon = {
      coords: [
        [0, 0],
        [20, 0],
      ],
      h: 8,
      kind: "retaining_wall",
    };
    const g = wallGeometry([wall], ramp, offset, { snapToStep: true });
    const pos = g?.positions ?? [];
    const nrm = g?.normals ?? [];
    let caps = 0;
    for (let t = 0; t < pos.length; t += 9) {
      if (nrm[t + 1] < 0.99) {
        continue; // a face, not the cap
      }
      caps++;
      const [ax, , az, bx, , bz, cx, , cz] = pos.slice(t, t + 9);
      expect((bz - az) * (cx - ax) - (bx - ax) * (cz - az)).toBeGreaterThan(0);
    }
    expect(caps).toBeGreaterThan(0);
  }
});

/** The highest point of each column of a wall along y = 0 (by world x). */
function columnTops(positions: readonly number[]): number[] {
  const tops = new Map<number, number>();
  for (let i = 0; i < positions.length; i += 3) {
    const x = Math.round(positions[i] * 10) / 10;
    tops.set(
      x,
      Math.max(tops.get(x) ?? Number.NEGATIVE_INFINITY, positions[i + 1])
    );
  }
  return [...tops.values()];
}

test("a city wall standing well above its step stands its height on every column", () => {
  // A 9 m city wall along y = 0 with a 2 m step under its first half and
  // level ground under the rest: snapped, the first half ended at its 2 m
  // shelf while the rest stood 9 m — a sawtooth along the wall.
  const ground = (x: number, y: number) =>
    x < 10 ? 100 + 2 * Math.min(Math.max((y + 0.5) / 2, 0), 1) : 100;
  const wall: WallRibbon = {
    coords: [
      [0, 0],
      [20, 0],
    ],
    h: 9,
    kind: "city_wall",
  };
  const g = wallGeometry([wall], ground, offset, { snapToStep: true });
  for (const top of columnTops(g?.positions ?? [])) {
    expect(top).toBeCloseTo(109, 1);
  }
});

test("a city wall that holds the earth ends at its shelf and stands where the ground is level", () => {
  // The same wall 8 m high in front of an 8 m step under its first half:
  // it holds that earth, so it ends at its shelf there, and on the level
  // ground beyond it still stands its 8 m — not buried at the ground.
  const ground = (x: number, y: number) =>
    x < 10 ? 100 + 8 * Math.min(Math.max((y + 0.5) / 2, 0), 1) : 100;
  const wall: WallRibbon = {
    coords: [
      [0, 0],
      [20, 0],
    ],
    h: 8,
    kind: "city_wall",
  };
  const g = wallGeometry([wall], ground, offset, { snapToStep: true });
  for (const top of columnTops(g?.positions ?? [])) {
    expect(top).toBeCloseTo(108, 1);
  }
  // Only a snapped column's cap runs back to the shelf the wall holds (the
  // ramp tops out at y = 1.5); standing free, the cap spans the wall's
  // 1 m body, which on the step stood 1.5 m onto the low side.
  const pos = g?.positions ?? [];
  const capBack = (from: number, to: number) => {
    let north = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] >= from && pos[i] <= to && Math.abs(pos[i + 1] - 108) < 0.01) {
        north = Math.max(north, -pos[i + 2]);
      }
    }
    return north;
  };
  expect(capBack(0, 7.5)).toBeGreaterThanOrEqual(1.5);
  expect(capBack(12.5, 20)).toBeLessThan(1);
});

test("a wall whose scan finds two terraces stands at each, not across them", () => {
  // A retaining wall along y = 0 between two terrace steps the DGM blurs
  // into 1 m ramps: at y = −4 (the taller for x < 7) and at y = +4 (the
  // taller beyond). Its columns snap to one step or the other; joined, they
  // stood a block 10 m deep over the terrace between (Meißen's Burgberg).
  const ramp = (y: number, at: number, rise: number) =>
    Math.min(Math.max(y - at + 0.5, 0), 1) * rise;
  const ground = (x: number, y: number) =>
    100 + ramp(y, -4, x < 7 ? 6 : 4) + ramp(y, 4, x < 7 ? 4 : 6);
  const wall: WallRibbon = {
    coords: [
      [0, 0],
      [15, 0],
    ],
    h: 3,
    kind: "retaining_wall",
  };
  const g = wallGeometry([wall], ground, offset, { snapToStep: true });
  const pos = g?.positions ?? [];
  expect(pos.length).toBeGreaterThan(0);
  for (let t = 0; t < pos.length; t += 9) {
    const zs = [pos[t + 2], pos[t + 5], pos[t + 8]];
    // no triangle reaches across the terrace (world z = −north)
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(3);
  }
});

test("each wall's vertices carry its masonry's tone; none is stone", () => {
  const brick: WallRibbon = { ...line(3), mat: "brick" };
  const plain: WallRibbon = {
    coords: [
      [0, 20],
      [10, 20],
    ],
    h: 3,
  };
  const g = wallGeometry([brick, plain], flat, offset);
  expect(g).not.toBeNull();
  const tones = g?.tones ?? [];
  expect(tones.length * 3).toBe(g?.positions.length ?? -1);
  // the brick ribbon first (24 vertices), then the plain one
  expect(new Set(tones.slice(0, 24))).toEqual(
    new Set([MASONRY.indexOf("brick")])
  );
  expect(new Set(tones.slice(24))).toEqual(new Set([MASONRY.indexOf("stone")]));
  const colors = wallColors(tones);
  expect(colors.length).toBe(tones.length * 3);
  const [r, gr, b] = linearTone(WALL_TONES.brick);
  expect(colors[0]).toBeCloseTo(r, 6);
  expect(colors[1]).toBeCloseTo(gr, 6);
  expect(colors[2]).toBeCloseTo(b, 6);
  // linear: sRGB 0xc9 is ≈ 0.58 linear, not 0.79
  expect(linearTone(0xc9_c9_c9)[0]).toBeCloseTo(0.584, 2);
});

test("a material the viewer does not know is no material", () => {
  expect(masonryOf("brick")).toBe("brick");
  expect(masonryOf("marble")).toBeUndefined();
  expect(masonryOf(3)).toBeUndefined();
});
