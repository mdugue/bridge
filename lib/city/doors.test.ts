import { describe, expect, test } from "bun:test";
import {
  DOOR_SURROUND,
  doorMesh,
  eaveAlong,
  wallShift,
  wallShiftAlong,
  wallShiftKnots,
} from "./doors";
import type { DoorFeature } from "./features";

const door = (nx: number, ny: number): DoorFeature => ({
  geometry: { type: "Point", coordinates: [100, 200] },
  properties: { of: "a", kind: "yes", nx, ny, w: 1.2, h: 2.5, z: 10 },
});
const offset = { cx: 0, cy: 0 };

/** A wall facing +x at x = 100 + b, from y 190 to 210 and z 0 to 30. */
function wall(b: number, facing = 1): number[] {
  const x = 100 + b;
  const quad = [
    [x, 190, 0],
    [x, 210, 0],
    [x, 210, 30],
    [x, 190, 30],
  ];
  const [q0, q1, q2, q3] = facing > 0 ? quad : [...quad].reverse();
  return [...q0, ...q1, ...q2, ...q0, ...q2, ...q3];
}

const faceNormals = (tris: number[]) => {
  const out: number[][] = [];
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(i, i + 9);
    const u = [bx - ax, by - ay, bz - az];
    const v = [cx - ax, cy - ay, cz - az];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const l = Math.hypot(...n);
    out.push(n.map((c) => Math.round(c / l)));
  }
  return out;
};

describe("doorMesh", () => {
  test("its fronts face out of the wall, none faces into it", () => {
    const { leaf, surround } = doorMesh(door(1, 0), offset);
    expect(faceNormals(leaf).every(([x]) => x === 1)).toBe(true);
    expect(faceNormals(surround).some(([x]) => x === -1)).toBe(false);
    expect(faceNormals(surround).filter(([x]) => x === 1)).toHaveLength(6);
  });

  test("a shift lays it out along the normal", () => {
    const xs = (tris: number[]) => tris.filter((_, i) => i % 3 === 0);
    const at = Math.max(...xs(doorMesh(door(1, 0), offset).surround));
    const moved = Math.max(...xs(doorMesh(door(1, 0), offset, 0.2).surround));
    expect(at).toBeCloseTo(100 + DOOR_SURROUND.proud, 6);
    expect(moved).toBeCloseTo(at + 0.2, 6);
  });
});

describe("wallShift", () => {
  test("finds the wall standing proud of or back from the footprint", () => {
    for (const b of [0.15, 0, -0.1]) {
      const tris = wall(b);
      expect(wallShift(door(1, 0), offset, tris, [0, 3])).toBeCloseTo(b, 6);
    }
  });

  test("takes the outermost wall where the door spans two", () => {
    const tris = [...wall(-0.05), ...wall(0.12)];
    expect(wallShift(door(1, 0), offset, tris, [0, 3, 6, 9])).toBeCloseTo(
      0.12,
      6
    );
  });

  test("ignores a wall facing away and one out of reach", () => {
    expect(wallShift(door(1, 0), offset, wall(0.1, -1), [0, 3])).toBe(0);
    expect(wallShift(door(1, 0), offset, wall(2), [0, 3])).toBe(0);
  });
});

describe("wallShiftAlong", () => {
  const run = [
    [100, 195],
    [100, 205],
  ] as const;
  test("finds the wall a stretch runs along, either side of its line", () => {
    for (const b of [0.15, 0, -0.1]) {
      const [sa, sb] = wallShiftAlong(run, [1, 3], offset, wall(b), [0, 3]);
      expect(sa).toBeCloseTo(b, 6);
      expect(sb).toBeCloseTo(b, 6);
    }
  });

  test("follows a wall turned against the footprint line, end to end", () => {
    // out of the line by 0.1 at y 190, back from it by 0.1 at y 210
    const turned = [
      [100.1, 190, 0],
      [99.9, 210, 0],
      [99.9, 210, 30],
      [100.1, 190, 0],
      [99.9, 210, 30],
      [100.1, 190, 30],
    ].flat();
    const [sa, sb] = wallShiftAlong(run, [1, 3], offset, turned, [0, 3]);
    expect(sa).toBeCloseTo(0.05, 3);
    expect(sb).toBeCloseTo(-0.05, 3);
  });

  test("is 0 where no wall faces the stretch", () => {
    expect(wallShiftAlong(run, [1, 3], offset, wall(0.1, -1), [0, 3])).toEqual([
      0, 0,
    ]);
    expect(wallShiftAlong(run, [40, 41], offset, wall(0.1), [0, 3])).toEqual([
      0, 0,
    ]);
  });
});

describe("eaveAlong", () => {
  const run = [
    [100, 195],
    [100, 205],
  ] as const;
  /** A roof face over x 94..100 (y 190..210), its height at (x, y). */
  const roof = (z: (x: number, y: number) => number): number[] => {
    const q = [
      [100, 190],
      [100, 210],
      [94, 210],
      [94, 190],
    ].map(([x, y]) => [x, y, z(x, y)]);
    return [...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]];
  };

  test("reads where a roof falling to the wall meets it", () => {
    const pitched = roof((x) => 12 + (100 - x));
    expect(eaveAlong(run, [0, 0], offset, pitched, [0, 3])).toBeCloseTo(12, 6);
    // the wall standing back from the line: the eave on the wall
    expect(eaveAlong(run, [-0.1, -0.1], offset, pitched, [0, 3])).toBeCloseTo(
      12.1,
      6
    );
  });

  test("a gable, the roof climbing along the wall, has none", () => {
    const gable = roof((_, y) => 12 + (y - 190) * 0.5);
    expect(eaveAlong(run, [0, 0], offset, gable, [0, 3])).toBeUndefined();
  });

  test("no roof over the wall, no eave", () => {
    expect(eaveAlong(run, [0, 0], offset, [], [])).toBeUndefined();
  });
});

test("wallShiftKnots follows a wall that bends, where one line would cut it", () => {
  // out of the line by 0.05 at y 190 and 210, by 0.2 at y 200
  const bent = [
    [100.05, 190, 0],
    [100.2, 200, 0],
    [100.2, 200, 30],
    [100.05, 190, 0],
    [100.2, 200, 30],
    [100.05, 190, 30],
    [100.2, 200, 0],
    [100.05, 210, 0],
    [100.05, 210, 30],
    [100.2, 200, 0],
    [100.05, 210, 30],
    [100.2, 200, 30],
  ].flat();
  const { f, s } = wallShiftKnots(
    [
      [100, 190],
      [100, 210],
    ],
    [1, 3],
    offset,
    bent,
    [0, 3, 6, 9]
  );
  expect(f).toHaveLength(21);
  expect(s[10]).toBeCloseTo(0.2, 6);
  expect(s[0]).toBeCloseTo(0.05 + 0.015 * 0.1, 6);
  expect(s[5]).toBeCloseTo(0.125, 6);
});
