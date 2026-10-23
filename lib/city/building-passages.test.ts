import { expect, test } from "bun:test";
import {
  cutOut,
  DRIVE_H,
  groundUnder,
  KEEP_M,
  LINTEL_M,
  type PassageAxis,
  passageHeight,
  passageLining,
  passageRegions,
  TRACK_H,
  touches,
  WALK_H,
} from "./building-passages";
import { SINK } from "./ground-join";

/** A triangle's area (flat x, y, z ×3). */
function area(t: readonly number[]): number {
  const u = [t[3] - t[0], t[4] - t[1], t[5] - t[2]];
  const v = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
  return (
    Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ) / 2
  );
}

const total = (tris: readonly number[]) => {
  let a = 0;
  for (let k = 0; k + 8 < tris.length; k += 9) {
    a += area(tris.slice(k, k + 9));
  }
  return a;
};

/** A triangle's normal (unnormalised). */
function normal(t: readonly number[]): [number, number, number] {
  const u = [t[3] - t[0], t[4] - t[1], t[5] - t[2]];
  const v = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

// a footway 3 m wide running north through a wall in the plane y = 0,
// on level ground at 100 m
const straight: PassageAxis = {
  axis: [
    [0, -2],
    [0, 2],
  ],
  ground: [100, 100],
  h: 3,
  w: 3,
};

/** The wall y = 0 from x −10 to 10, z 99 to 112, as two triangles facing
 *  north (+y). */
const wall = [
  [-10, 0, 99, 10, 0, 112, 10, 0, 99],
  [-10, 0, 99, -10, 0, 112, 10, 0, 112],
];

test("a passage takes the kind's height, or the storey's less a lintel", () => {
  const house = { eaveZ: 115, storeyH: 3.2 };
  expect(passageHeight("footway", null, 100, [house])).toBe(WALK_H);
  expect(passageHeight("service", null, 100, [house])).toBe(DRIVE_H);
  // a palace's storey
  const palace = { eaveZ: 125, storeyH: 5.5 };
  expect(passageHeight("footway", null, 100, [palace])).toBeCloseTo(
    5.5 - LINTEL_M
  );
  // OSM's maxheight wins
  expect(passageHeight("service", 4.2, 100, [palace])).toBe(4.2);
  // a track into its shed: a contact wire's clearance
  expect(passageHeight("railway", null, 100, [palace])).toBe(TRACK_H);
});

test("a passage keeps under the lowest eave over it, or is none", () => {
  const low = { eaveZ: 104, storeyH: 3 };
  expect(passageHeight("service", null, 100, [low])).toBeCloseTo(4 - KEEP_M);
  expect(
    passageHeight("service", null, 100, [{ eaveZ: 102.8, storeyH: 3 }])
  ).toBe(null);
  expect(passageHeight("service", null, 100, [])).toBe(null);
});

test("the cut opens the wall where the passage runs through, and no more", () => {
  const regions = passageRegions(straight);
  expect(regions).toHaveLength(1);
  const before = wall.reduce((a, t) => a + area(t), 0);
  const cut = wall.flatMap((t) => cutOut(t, regions));
  // the opening: 3 m wide, from SINK.wall under the ground (the wall's
  // foot further under it stays) to 3 m over it
  const opening = 3 * (3 + SINK.wall);
  expect(total(cut)).toBeCloseTo(before - opening, 4);
  // nothing left inside it
  for (let k = 0; k + 8 < cut.length; k += 9) {
    const t = cut.slice(k, k + 9);
    const cx = (t[0] + t[3] + t[6]) / 3;
    const cz = (t[2] + t[5] + t[8]) / 3;
    expect(Math.abs(cx) < 1.5 && cz < 103 && cz > 100 - SINK.wall).toBe(false);
    // the winding kept: still facing north
    expect(normal(t)[1]).toBeGreaterThan(0);
  }
});

test("a triangle the passage misses is kept whole", () => {
  const regions = passageRegions(straight);
  const far = [20, 0, 99, 30, 0, 112, 30, 0, 99];
  expect(touches(far, regions[0])).toBe(false);
  expect(cutOut(far, regions)).toEqual(far);
  // above the ceiling
  const high = [-10, 0, 104, 10, 0, 112, 10, 0, 104];
  expect(total(cutOut(high, regions))).toBeCloseTo(area(high), 6);
});

test("a falling passage's ceiling falls with its ground", () => {
  const falling: PassageAxis = {
    axis: [
      [0, 0],
      [0, 10],
    ],
    ground: [104, 100],
    h: 3,
    w: 2,
  };
  const [region] = passageRegions(falling);
  const inside = (x: number, y: number, z: number) =>
    region.every((pl) => pl[0] * x + pl[1] * y + pl[2] * z + pl[3] <= 1e-9);
  expect(inside(0, 1, 106.5)).toBe(true);
  expect(inside(0, 9, 106.5)).toBe(false);
  expect(inside(0, 9, 102.5)).toBe(true);
  expect(inside(0, 9, 100 - SINK.wall - 0.1)).toBe(false);
  expect(groundUnder(falling, [0.4, 5])).toBeCloseTo(102);
});

test("a bend is mitred: the two prisms meet on its bisector", () => {
  const bent: PassageAxis = {
    axis: [
      [0, 0],
      [0, 10],
      [10, 10],
    ],
    ground: [100, 100, 100],
    h: 3,
    w: 2,
  };
  const [a, b] = passageRegions(bent);
  const inside = (r: typeof a, x: number, y: number) =>
    r.every((pl) => pl[0] * x + pl[1] * y + pl[2] * 101 + pl[3] <= 1e-9);
  // the outer corner of the bend lies in one of them, on the bisector
  expect(inside(a, -0.9, 10.8) || inside(b, -0.9, 10.8)).toBe(true);
  expect(inside(a, 0.5, 10.2) && inside(b, 0.5, 10.2)).toBe(false);
});

test("the lining's walls face into the passage and its ceiling down", () => {
  const lining = passageLining(
    straight,
    {
      // the walls 1.5 m either side, each walked with the passage on its
      // left; the ceiling's plan
      sides: [
        [
          [1.5, -2],
          [1.5, 2],
        ],
        [
          [-1.5, 2],
          [-1.5, -2],
        ],
      ],
      roof: [
        [
          [-1.5, -2],
          [1.5, -2],
          [1.5, 2],
          [-1.5, 2],
          [-1.5, -2],
        ],
      ],
    },
    // two triangles of a quad, counter-clockwise
    () => [0, 1, 2, 0, 2, 3]
  );
  expect(lining.length / 9).toBe(4 + 2);
  for (let k = 0; k + 8 < lining.length; k += 9) {
    const t = lining.slice(k, k + 9);
    const n = normal(t);
    const cx = (t[0] + t[3] + t[6]) / 3;
    if (Math.abs(n[2]) > 1e-9) {
      // the ceiling: facing down, 3 m over the ground
      expect(n[2]).toBeLessThan(0);
      expect(t[2]).toBeCloseTo(103);
    } else {
      // a wall: facing the axis
      expect(Math.sign(n[0])).toBe(-Math.sign(cx));
      const zs = [t[2], t[5], t[8]];
      expect(Math.min(...zs)).toBeCloseTo(100 - SINK.wall);
      expect(Math.max(...zs)).toBeCloseTo(103);
    }
  }
});
