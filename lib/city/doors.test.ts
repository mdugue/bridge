import { describe, expect, test } from "bun:test";
import { DOOR_SURROUND, doorMesh, wallShift, wallShiftAlong } from "./doors";
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
