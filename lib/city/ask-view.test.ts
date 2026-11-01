import { expect, test } from "bun:test";
import {
  ASK_FOV,
  type AskTarget,
  boundsTarget,
  type Framed,
  frameTargets,
  streetView,
} from "./ask-view";

test("on foot the walker stands in front, on the side they come from, looking at it", () => {
  const v = streetView({ x: 1000, y: 2000, h: 20 }, { x: 1000, y: 1500 });
  expect(v.mode).toBe("walk");
  expect(v.aboveGround).toBe(1.6);
  // south of it, 43 m back, looking north and up
  expect(v.epsg.x).toBe(1000);
  expect(v.epsg.y).toBeCloseTo(2000 - 43, 5);
  expect(v.headingDeg).toBe(0);
  expect(v.pitchDeg).toBeGreaterThan(0);
});

test("standing on the target, it is approached from the south", () => {
  const v = streetView({ x: 5, y: 5 }, { x: 5, y: 5 });
  expect(v.epsg.y).toBeLessThan(5);
  expect(v.headingDeg).toBe(0);
});

/** Whether a point lies inside the view's lens on a screen of `aspect`. */
function inView(
  framed: Framed,
  ground: number,
  aspect: number,
  p: { x: number; y: number; z: number }
): boolean {
  const { view } = framed;
  const t = (view.headingDeg * Math.PI) / 180;
  const pitch = (-view.pitchDeg * Math.PI) / 180;
  const f = [
    Math.sin(t) * Math.cos(pitch),
    Math.cos(t) * Math.cos(pitch),
    -Math.sin(pitch),
  ];
  const r = [Math.cos(t), -Math.sin(t), 0];
  const u = [
    Math.sin(t) * Math.sin(pitch),
    Math.cos(t) * Math.sin(pitch),
    Math.cos(pitch),
  ];
  const q = [
    p.x - view.epsg.x,
    p.y - view.epsg.y,
    p.z - (ground + view.aboveGround),
  ];
  const d = (a: number[]) => a[0] * q[0] + a[1] * q[1] + a[2] * q[2];
  const tanV = Math.tan(((ASK_FOV / 2) * Math.PI) / 180);
  const depth = d(f);
  return (
    depth > 0 &&
    Math.abs(d(r)) <= depth * tanV * aspect + 0.5 &&
    Math.abs(d(u)) <= depth * tanV + 0.5
  );
}

/** Every corner of every place's box, foot and top. */
function corners(targets: readonly AskTarget[]) {
  return targets.flatMap((t) =>
    [-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sy) =>
        [0, t.h ?? 0].map((dz) => ({
          x: t.x + sx * (t.r ?? 0) * 0.7,
          y: t.y + sy * (t.r ?? 0) * 0.7,
          z: (t.z ?? 0) + dz,
        }))
      )
    )
  );
}

const church: AskTarget = { x: 0, y: 0, z: 110, h: 90, r: 25 };
const square: AskTarget[] = [
  { x: 0, y: 0, z: 110, h: 20, r: 15 },
  { x: 300, y: 40, z: 112, h: 25, r: 20 },
  { x: -250, y: -60, z: 108, h: 18, r: 12 },
];

// a tower and two low halls on one side: no symmetry to hide an error
const lopsided: AskTarget[] = [
  { x: 0, y: 0, z: 100, h: 150, r: 10 },
  { x: 0, y: 200, z: 100, h: 8, r: 40 },
  { x: 120, y: -30, z: 100, h: 8, r: 40 },
];

test("from the air every place stands whole inside the lens", () => {
  for (const aspect of [16 / 9, 0.46, 1.5]) {
    for (const targets of [[church], square, lopsided]) {
      const framed = frameTargets(targets, {
        aspect,
        from: { x: 0, y: -2000 },
      });
      expect(framed.view.mode).toBe("fly");
      const ground = Math.min(...targets.map((t) => t.z ?? 0));
      for (const p of corners(targets)) {
        expect(inView(framed, ground, aspect, p)).toBe(true);
      }
    }
  }
});

test("a narrow phone screen stands further back than a wide one", () => {
  const wide = frameTargets(square, { aspect: 16 / 9, from: null });
  const narrow = frameTargets(square, { aspect: 0.46, from: null });
  expect(narrow.distance).toBeGreaterThan(wide.distance * 1.5);
});

test("a tall tower is seen from lower down than a spread square", () => {
  const tower = frameTargets([church], { aspect: 1.5, from: null });
  const spread = frameTargets(square, { aspect: 1.5, from: null });
  expect(tower.view.pitchDeg).toBeGreaterThan(spread.view.pitchDeg);
  expect(tower.view.pitchDeg).toBeLessThanOrEqual(-30);
  expect(spread.view.pitchDeg).toBeGreaterThanOrEqual(-55);
});

test("it comes from the visitor's side and keeps the sun behind the camera", () => {
  const fromWest = frameTargets([church], {
    aspect: 1.5,
    from: { x: -3000, y: 0 },
  });
  // the eye west of it, looking east
  expect(fromWest.view.epsg.x).toBeLessThan(0);
  expect(fromWest.view.headingDeg).toBe(90);
  // a low sun in the south: the eye south of it, looking north
  const sunny = frameTargets([church], {
    aspect: 1.5,
    from: null,
    sun: { east: 0, north: -1 },
  });
  expect(sunny.view.headingDeg).toBe(0);
});

test("places in a row are seen side by side, not behind each other", () => {
  const row: AskTarget[] = [
    { x: -200, y: 0, z: 0, h: 20, r: 10 },
    { x: 0, y: 0, z: 0, h: 20, r: 10 },
    { x: 200, y: 0, z: 0, h: 20, r: 10 },
  ];
  const framed = frameTargets(row, { aspect: 16 / 9, from: null });
  expect([0, 180]).toContain(framed.view.headingDeg);
});

test("a heading whose sight lines a building cuts loses", () => {
  // a block south of the church hides it from every eye south of it
  const sightHit = (
    eye: { x: number; y: number; z: number },
    p: { x: number; y: number; z: number }
  ) => (eye.y < -50 && p.y > eye.y ? { x: 0, y: -60, z: 140 } : null);
  const framed = frameTargets([church], {
    aspect: 1.5,
    from: { x: 0, y: -3000 },
    sightHit,
  });
  expect(framed.view.epsg.y).toBeGreaterThan(-50);
  // its own roof met before its top is no obstacle
  const own = frameTargets([church], {
    aspect: 1.5,
    from: { x: 0, y: -3000 },
    sightHit: () => ({ x: 5, y: -10, z: 190 }),
  });
  expect(own.view.headingDeg).toBe(0);
});

test("a selection's place is its triangles' footprint centre, foot, height and radius", () => {
  // a 20 × 10 m box, 30 m high, its foot at 100 m
  const box = boundsTarget([
    -10, 100, -5, 10, 100, 5, 10, 130, -5, -10, 130, 5,
  ]);
  expect(box).not.toBeNull();
  expect(box?.x).toBe(0);
  expect(box?.z).toBe(0);
  expect(box?.foot).toBe(100);
  expect(box?.h).toBe(30);
  expect(box?.r).toBeCloseTo(Math.hypot(20, 10) / 2, 6);
  expect(boundsTarget([])).toBeNull();
});

// a house on the brow of a valley side: the ground falls 100 m to the
// south-west within 150 m and rises gently behind it (the Elbhang)
const brow = (x: number, y: number) => {
  const down = Math.max(0, -(x + y) / Math.SQRT2);
  return (
    205 - Math.min(100, down / 1.5) + Math.max(0, (x + y) / Math.SQRT2) / 20
  );
};
const luisenhof: AskTarget = { x: 0, y: 0, z: 205, h: 29, r: 32 };

test("on a slope the eye's height is over the ground beneath the eye", () => {
  for (const sun of [{ east: -1, north: -1 }, { east: 1, north: 1 }, null]) {
    const framed = frameTargets([luisenhof], {
      aspect: 16 / 9,
      from: { x: -3000, y: -3000 },
      sun,
      groundAt: brow,
    });
    const { view } = framed;
    const under = brow(view.epsg.x, view.epsg.y);
    // the house stands whole in the lens from the eye the glide sets
    for (const p of corners([luisenhof])) {
      expect(inView(framed, under, 16 / 9, p)).toBe(true);
    }
    // and the eye stands well clear of the hillside
    expect(view.aboveGround).toBeGreaterThanOrEqual(25);
  }
});

test("an eye a hill would bury backs off until it stands clear", () => {
  // a ridge 145 m over the house, 60 m south of it
  const ridge = (_x: number, y: number) => (y < -60 && y > -400 ? 265 : 100);
  const framed = frameTargets([{ x: 0, y: 0, z: 100, h: 20, r: 10 }], {
    aspect: 1.5,
    from: { x: 0, y: -3000 },
    groundAt: ridge,
  });
  // clear of the ridge, and the house's top in sight over it
  const { epsg, aboveGround } = framed.view;
  const eyeZ = ridge(epsg.x, epsg.y) + aboveGround;
  expect(aboveGround).toBeGreaterThanOrEqual(25);
  for (let k = 1; k < 20; k++) {
    const t = k / 20;
    const y = epsg.y * (1 - t);
    expect(ridge(epsg.x * (1 - t), y)).toBeLessThan(eyeZ + (120 - eyeZ) * t);
  }
});

test("on foot below a house on a slope, the walker looks up to it", () => {
  const flat = streetView({ x: 0, y: 0, h: 20 }, { x: -1, y: -1 });
  const below = streetView(
    { x: 0, y: 0, z: 205, h: 20 },
    { x: -1, y: -1 },
    brow
  );
  expect(below.pitchDeg).toBeGreaterThan(flat.pitchDeg);
});
