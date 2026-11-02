import { expect, test } from "bun:test";
import {
  type NameplateBody,
  type NameplateCamera,
  type NameplateScene,
  type Vec3,
  capHeight,
  chooseNameplate,
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
  // high above but far off, the ground seen flat: upright, not lying
  expect(nameplateMode(BODY, look([0, 120, 400], [0, 0, 0]), null)).toBe("far");
  // standing under a tree, its foot steeply below: upright
  const tree = nameplateBody(box(-2, 2, -2, 2, 10)) as NameplateBody;
  expect(nameplateMode(tree, look([0.5, 1.7, 1], [0, 6, 0]), null)).not.toBe(
    "air"
  );
  // Modell looking in at a shallow angle: upright
  expect(nameplateMode(BODY, look([0, 100, 300], [0, 0, 0], true), null)).toBe(
    "street"
  );
  // the ground laying holds down to 40°, and is entered only past 50°
  const at45 = look([0, 100, 100], [0, 0, 0]);
  expect(nameplateMode(BODY, at45, "air")).toBe("air");
  expect(nameplateMode(BODY, at45, null)).not.toBe("air");
  // just past the far threshold (8 S = 240 m) it is far, from street too;
  // just inside it far holds (it is left only within 0.8 × 8 S)
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
  // 9 % of 40 m wide at most, the screen's minimum far off
  expect(capNear).toBeCloseTo(3.6, 1);
  // and no larger on screen than the range's maximum
  expect(capHeight(BODY, near, at, { min: 20, max: 60 })).toBeLessThan(capNear);
  const pxFar = (capFar * 1000) / 1990;
  expect(pxFar).toBeCloseTo(20, 0);
});

test("a street plate stands on the roof in front of the facade, reading left to right", () => {
  const camera = look([0, 1.7, 150], [0, 15, 0]);
  const side = nameplateSide(BODY, camera, null);
  const at = (spot: "above" | "right") =>
    nameplatePose(
      BODY,
      { mode: "street", side, spot },
      camera,
      { width: 6, height: 2 },
      { min: 20, max: 60 },
      () => 0
    );
  const pose = at("above");
  expect(pose.origin[2]).toBeGreaterThan(10); // before the facade at z = 10
  // on the roof: its descenders' room just under the top, no leader
  expect(pose.origin[1]).toBeLessThan(30);
  expect(pose.origin[1] + 0.3 * pose.cap).toBeGreaterThan(30);
  expect(pose.anchor).toBeNull();
  expect(pose.up).toEqual([0, 1, 0]);
  // its right runs with the camera's
  expect(pose.right[0] * camera.right[0]).toBeGreaterThan(0);
  expect(pose.fade).toBe(1);
  // beside it in the sky, a hairline down to it
  expect(at("right").anchor).not.toBeNull();
});

test("rooftop letters stand on the nave's eave under a tower", () => {
  const camera = look([0, 1.7, 150], [0, 15, 0]);
  const side = nameplateSide(BODY, camera, null);
  const pose = (body: NameplateBody) =>
    nameplatePose(
      body,
      { mode: "street", side, spot: "above" },
      camera,
      { width: 6, height: 2 },
      { min: 20, max: 60 },
      () => 0
    );
  // the eave 18 m up, the tower to 30 m: on the eave
  const onEave = pose({ ...BODY, eave: 18 });
  expect(onEave.origin[1]).toBeLessThan(18);
  expect(onEave.origin[1] + 0.3 * onEave.cap).toBeGreaterThan(18);
  // an eave just under the top (a flat roof's parapet): on the top
  expect(pose({ ...BODY, eave: 28 }).origin[1]).toBeGreaterThan(27);
});

test("up close the letters stand on the ground before the facade", () => {
  const camera = look([0, 1.7, 25], [0, 10, 0]);
  const pose = nameplatePose(
    BODY,
    { mode: "near", side: nameplateSide(BODY, camera, null), spot: "front" },
    camera,
    { width: 6, height: 2 },
    { min: 20, max: 60 },
    (x) => (x > 0 ? 1.2 : 0.4)
  );
  // a quarter of the building's height over the highest ground under
  // them
  expect(pose.origin[1]).toBeCloseTo(1.2 + 7.5);
  expect(pose.anchor).toBeNull();
});

test("a small thing's plate stands close before it", () => {
  const bench = nameplateBody(box(-1, 1, -0.3, 0.3, 0.9)) as NameplateBody;
  const camera = look([0, 1.7, 12], [0, 0.5, 0]);
  const pose = nameplatePose(
    bench,
    { mode: "street", side: nameplateSide(bench, camera, null), spot: "above" },
    camera,
    { width: 4, height: 1.5 },
    { min: 12, max: 30 },
    () => 0
  );
  // 0.3 m before its 0.3 m deep side, not the building's 1.5 m
  expect(pose.origin[2]).toBeCloseTo(0.6, 1);
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
  // its letters stand on the ground: their depth and a kerb's height
  // over it
  expect(pose.origin[1]).toBeCloseTo(3 + 0.1 + 0.14 * pose.cap);
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

test("a ground place seen too flat is none: the plate stands up", () => {
  // Schwarzplan asks for the ground from just over the roof, far off
  const camera = look([0, 45, 160], [0, 0, 0]);
  const scene: NameplateScene = {
    camera,
    project: (p) => {
      const d: Vec3 = [
        p[0] - camera.position[0],
        p[1] - camera.position[1],
        p[2] - camera.position[2],
      ];
      const z =
        d[0] * camera.forward[0] +
        d[1] * camera.forward[1] +
        d[2] * camera.forward[2];
      return { x: 0, y: 0, front: z > 0 };
    },
    hidden: () => 0,
    hud: [],
    groundAt: () => 0,
  };
  const block = { width: 6, height: 2 };
  const range = { min: 20, max: 60 };
  const chosen = chooseNameplate(BODY, null, block, range, scene, "air");
  expect(chosen.mode).toBe("street");
  // from steeply above it lies on the ground
  const above = look([0, 300, 60], [0, 0, 0]);
  expect(
    chooseNameplate(
      BODY,
      null,
      block,
      range,
      { ...scene, camera: above },
      "air"
    ).mode
  ).toBe("air");
});

test("from above, the ground plate's side follows the screen's foot, with hysteresis", () => {
  const yawed = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return look([60 * Math.sin(a), 300, 60 * Math.cos(a)], [0, 0, 0]);
  };
  const side = nameplateSide(BODY, yawed(0), null, "air");
  expect(side % 2).toBe(1); // the screen's foot towards +z
  // the view turned 50°: the side stays (no quarter turn of the text)
  expect(nameplateSide(BODY, yawed(50), side, "air")).toBe(side);
  // turned 80°: it takes the side along x
  expect(nameplateSide(BODY, yawed(80), side, "air") % 2).toBe(0);
});

test("a kept facade turns once the camera is behind its plate", () => {
  // 80 × 60 m: the plate on +u stands 41.5 m out
  const deep = nameplateBody(box(-40, 40, -30, 30, 20)) as NameplateBody;
  const side = nameplateSide(deep, look([150, 1.7, 0], [0, 10, 0]), null);
  expect(side).toBe(0);
  // at (25, 45): +u still faces it within the turn angle, but the camera
  // stands behind the plate's plane
  const behind = look([25, 1.7, 45], [0, 10, 0]);
  expect(nameplateSide(deep, behind, side)).not.toBe(side);
});

test("a fresh facade is one the camera stands before", () => {
  // 100 × 10 m: from (45, 40) +u faces best, but its plate (at u = 51.5)
  // would stand behind the camera
  const hall = nameplateBody(box(-50, 50, -5, 5, 15)) as NameplateBody;
  const side = nameplateSide(hall, look([45, 1.7, 40], [0, 7, 0]), null);
  expect(side % 2).toBe(1);
});
