import { expect, test } from "bun:test";
import {
  type NameplateBody,
  type NameplateCamera,
  type NameplateScene,
  type Vec3,
  capHeight,
  chooseNameplate,
  hull2,
  nameplateBody,
  nameplateMode,
  nameplatePose,
  nameplateSide,
  sameLayout,
} from "./nameplate-place";

/** A box's triangles' positions (only its corners matter here). */
function box(x0: number, x1: number, z0: number, z1: number, h: number) {
  const out: number[] = [];
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) {
      out.push(x, 0, z, x, h, z);
    }
  }
  return new Float32Array(out);
}

/** A 40 × 20 m block, 30 m high, its long side along x. */
const BODY = nameplateBody(box(-20, 20, -10, 10, 30)) as NameplateBody;

/** A perspective camera at `position` looking at `target`. */
function look(position: Vec3, target: Vec3, ortho = false): NameplateCamera {
  const d: Vec3 = [
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ];
  const l = Math.hypot(...d);
  const forward: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const flat = Math.hypot(forward[0], forward[2]) || 1;
  const right: Vec3 = [-forward[2] / flat, 0, forward[0] / flat];
  return { position, forward, right, ortho, pxPerM: 1000 };
}

test("the body is the footprint's rectangle, its height span and peak", () => {
  expect(BODY.half[0]).toBeCloseTo(20);
  expect(BODY.half[1]).toBeCloseTo(10);
  expect(Math.abs(BODY.u[0])).toBeCloseTo(1);
  expect(BODY.base).toBe(0);
  expect(BODY.top).toBe(30);
  expect(BODY.center[0]).toBeCloseTo(0);
  expect(nameplateBody(new Float32Array(6))).toBeNull();
});

test("a turned footprint keeps its own axes", () => {
  const c = Math.SQRT1_2;
  const pts: number[] = [];
  for (const [a, b] of [
    [-20, -5],
    [20, -5],
    [20, 5],
    [-20, 5],
  ]) {
    pts.push(a * c - b * c, 0, a * c + b * c, a * c - b * c, 10, a * c + b * c);
  }
  const body = nameplateBody(new Float32Array(pts)) as NameplateBody;
  expect(body.half[0]).toBeCloseTo(20, 1);
  expect(body.half[1]).toBeCloseTo(5, 1);
  expect(Math.abs(body.u[0])).toBeCloseTo(c, 2);
});

test("the hull drops inner points", () => {
  const hull = hull2([
    [0, 0],
    [2, 0],
    [1, 1],
    [2, 2],
    [0, 2],
  ]);
  expect(hull).toHaveLength(4);
});

test("the laying follows the camera, with hysteresis", () => {
  const street = look([0, 1.7, 150], [0, 15, 0]);
  expect(nameplateMode(BODY, street, null)).toBe("street");
  expect(nameplateMode(BODY, look([0, 1.7, 20], [0, 15, 0]), null)).toBe(
    "near"
  );
  expect(nameplateMode(BODY, look([0, 1.7, 400], [0, 15, 0]), null)).toBe(
    "far"
  );
  expect(nameplateMode(BODY, look([0, 200, 50], [0, 0, 0]), null)).toBe("air");
  expect(nameplateMode(BODY, look([0, 500, 1], [0, 0, 0], true), null)).toBe(
    "air"
  );
  // just past the far threshold (8 S = 240 m): street holds, far holds
  const edge = look([0, 15, 255], [0, 15, 0]);
  expect(nameplateMode(BODY, edge, null)).toBe("far");
  expect(nameplateMode(BODY, edge, "street")).toBe("far");
  const inside = look([0, 15, 230], [0, 15, 0]);
  expect(nameplateMode(BODY, inside, "far")).toBe("far");
  expect(nameplateMode(BODY, inside, null)).toBe("street");
});

test("the facade the camera faces, kept until the view grows flat", () => {
  const front = look([0, 1.7, 150], [0, 15, 0]);
  const side = nameplateSide(BODY, front, null);
  expect(side % 2).toBe(1); // ±v faces z
  // a little round the corner: the facade stays
  const oblique = look([90, 1.7, 120], [0, 15, 0]);
  expect(nameplateSide(BODY, oblique, side)).toBe(side);
  // straight along x: it turns
  const along = look([150, 1.7, 5], [0, 15, 0]);
  expect(nameplateSide(BODY, along, side) % 2).toBe(0);
});

test("the capitals grow with nearness, clamped on screen", () => {
  const range = { min: 20, max: 200 };
  const near = look([0, 1.7, 40], [0, 15, 0]);
  const far = look([0, 1.7, 2000], [0, 15, 0]);
  const at: Vec3 = [0, 15, 10];
  const capNear = capHeight(BODY, near, at, range);
  const capFar = capHeight(BODY, far, at, range);
  // 7 % of 40 m wide at most, the screen's minimum far off
  expect(capNear).toBeCloseTo(2.8, 1);
  // and no larger on screen than the range's maximum
  expect(capHeight(BODY, near, at, { min: 20, max: 60 })).toBeLessThan(capNear);
  const pxFar = (capFar * 1000) / 1990;
  expect(pxFar).toBeCloseTo(20, 0);
});

test("a street plate stands in front of the facade, reading left to right", () => {
  const camera = look([0, 1.7, 150], [0, 15, 0]);
  const layout = {
    mode: "street" as const,
    side: nameplateSide(BODY, camera, null),
    spot: "above" as const,
  };
  const pose = nameplatePose(
    BODY,
    layout,
    camera,
    { width: 6, height: 2 },
    { min: 20, max: 60 },
    () => 0
  );
  expect(pose.origin[2]).toBeGreaterThan(10); // before the facade at z = 10
  expect(pose.origin[1]).toBeGreaterThan(30); // above the roof
  expect(pose.up).toEqual([0, 1, 0]);
  // its right runs with the camera's
  expect(pose.right[0] * camera.right[0]).toBeGreaterThan(0);
  expect(pose.anchor).not.toBeNull();
  expect(pose.fade).toBe(1);
});

test("an air plate lies on the ground beside the building", () => {
  const camera = look([0, 300, 60], [0, 0, 0]);
  const pose = nameplatePose(
    BODY,
    { mode: "air", side: 1, spot: "front" },
    camera,
    { width: 6, height: 2 },
    { min: 20, max: 60 },
    () => 3
  );
  expect(pose.origin[1]).toBeCloseTo(3.4);
  expect(pose.up[1]).toBe(0);
  expect(pose.anchor).toBeNull();
});

test("the choice avoids hidden and covered places and keeps its own", () => {
  const camera = look([0, 1.7, 150], [0, 15, 0]);
  const project = (p: Vec3) => {
    const d: Vec3 = [
      p[0] - camera.position[0],
      p[1] - camera.position[1],
      p[2] - camera.position[2],
    ];
    const z =
      d[0] * camera.forward[0] +
      d[1] * camera.forward[1] +
      d[2] * camera.forward[2];
    const x = d[0] * camera.right[0] + d[2] * camera.right[2];
    const y = d[1] - camera.forward[1] * z;
    return { x: (x / z) * 2, y: (y / z) * 2, front: z > 0 };
  };
  const scene = (hidden: (pts: Vec3[]) => number): NameplateScene => ({
    camera,
    project,
    hidden,
    hud: [],
    groundAt: () => 0,
  });
  const block = { width: 6, height: 2 };
  const range = { min: 20, max: 60 };
  const open = chooseNameplate(
    BODY,
    null,
    block,
    range,
    scene(() => 0)
  );
  expect(open.mode).toBe("street");
  expect(open.spot).toBe("above");
  // above hidden (say, a tower in front): it moves aside
  const aside = chooseNameplate(
    BODY,
    null,
    block,
    range,
    scene((pts) => (pts[0][1] > 30 ? 1 : 0))
  );
  expect(aside.spot).not.toBe("above");
  expect(sameLayout(open, { ...open })).toBe(true);
  expect(sameLayout(open, aside)).toBe(false);
  expect(sameLayout(null, open)).toBe(false);
});
