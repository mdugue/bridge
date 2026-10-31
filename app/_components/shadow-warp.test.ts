import { expect, test } from "bun:test";
import { Matrix4, Vector3, Vector4 } from "three/webgpu";
import {
  cutToBand,
  fitWarpedShadow,
  type WarpFit,
  type WarpView,
  warpCovers,
  warpDistance,
} from "./shadow-warp";

/** The desktop map's edge (texels). */
const MAP = 3072;

/** A sun 37° high in the south-west (world: x east, y up, z south). */
const SUN = new Vector3(-0.45, 0.6, 0.66).normalize();

/** A camera `height` m over flat ground at 110 m, `pitch`° down, turned
 *  `yaw`° from north toward east. */
function view(height: number, pitch: number, yaw = 0): WarpView {
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  const forward = new Vector3(
    Math.sin(y) * Math.cos(p),
    -Math.sin(p),
    -Math.cos(y) * Math.cos(p)
  );
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0));
  const up = new Vector3().crossVectors(right.normalize(), forward);
  return {
    aspect: 16 / 9,
    ceilingY: 240,
    eye: new Vector3(0, 110 + height, 0),
    floorY: 90,
    forward,
    fovDeg: 55,
    groundY: 110,
    reach: 2000,
    up: up.normalize(),
  };
}

/** Where `p` lands in the map's clip space (x, y in −1…1, z the depth). */
function clipOf(fit: WarpFit, p: Vector3): Vector3 {
  const q = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(fit.clip);
  return new Vector3(q.x / q.w, q.y / q.w, q.z / q.w);
}

const onMap = (c: Vector3) =>
  Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1 && Math.abs(c.z) <= 1;

/** The coarser side (m) of a map texel on the ground at `p`. */
function texelAt(fit: WarpFit, p: Vector3): number {
  const a = clipOf(fit, p);
  const span = (d: Vector3) => {
    const b = clipOf(fit, p.clone().add(d));
    return Math.hypot(b.x - a.x, b.y - a.y) * (MAP / 2);
  };
  return 1 / Math.min(span(new Vector3(1, 0, 0)), span(new Vector3(0, 0, 1)));
}

/** The ground `distance` m ahead of the eye along the view's heading. */
function ahead(v: WarpView, distance: number): Vector3 {
  const h = new Vector3(v.forward.x, 0, v.forward.z).normalize();
  return new Vector3(v.eye.x, v.groundY, v.eye.z).addScaledVector(h, distance);
}

test("the body cut to a band keeps what lies in it", () => {
  const eye = new Vector3(0, 300, 0);
  const far = [
    new Vector3(-100, 0, -100),
    new Vector3(100, 0, -100),
    new Vector3(100, 0, 100),
    new Vector3(-100, 0, 100),
  ];
  const cut = cutToBand([eye, ...far], 50, 150);
  // the four side edges, each crossing both planes (the base's edges and
  // diagonals lie under the band)
  expect(cut).toHaveLength(8);
  for (const p of cut) {
    expect(p.y).toBeGreaterThanOrEqual(50);
    expect(p.y).toBeLessThanOrEqual(150);
  }
  // a band the pyramid never reaches leaves nothing
  expect(cutToBand([eye, ...far], 400, 500)).toHaveLength(0);
});

test("looking along the sun the warp runs out to the plain fit", () => {
  expect(warpDistance(100, 2000, 0)).toBe(1e6);
  // the stronger the angle, the nearer the warp's eye
  expect(warpDistance(100, 2000, 1)).toBeLessThan(warpDistance(100, 2000, 0.3));
});

test("looking at the sky there is nothing to fit", () => {
  expect(fitWarpedShadow(view(150, -70), SUN)).toBeNull();
});

// The square of old (shadow-fit.ts) reached 275 m ahead from 100 m up,
// 605 m from 200 m and 1265 m from 400 m, and nothing past it.
for (const [height, pitch, yaw] of [
  [40, 15, 0],
  [100, 25, 0],
  [100, 25, 140],
  [200, 30, 70],
  [400, 20, 220],
] as const) {
  test(`from ${height} m the map holds the view out to 1.6 km (pitch ${pitch}°, yaw ${yaw}°)`, () => {
    const v = view(height, pitch, yaw);
    const fit = fitWarpedShadow(v, SUN);
    expect(fit).not.toBeNull();
    if (!fit) {
      return;
    }
    for (const d of [height, 300, 800, 1600]) {
      expect(onMap(clipOf(fit, ahead(v, d)))).toBe(true);
    }
    // texels fine where the ground is near, growing with the distance as
    // the screen's pixels do (a 1080-px-tall view at 55°: ~1 mm per m)
    const near = texelAt(fit, ahead(v, Math.max(height, 100)));
    expect(near).toBeLessThan(0.0045 * Math.max(height, 100));
    expect(texelAt(fit, ahead(v, 800))).toBeLessThan(2);
    expect(texelAt(fit, ahead(v, 800))).toBeGreaterThan(near);
  });
}

test("a tower beside the view still casts into it", () => {
  const v = view(150, 25);
  const fit = fitWarpedShadow(v, SUN);
  expect(fit).not.toBeNull();
  if (!fit) {
    return;
  }
  // a receiver 500 m ahead and the top of a 100 m tower on its sun ray
  const receiver = ahead(v, 500);
  const top = receiver.clone().addScaledVector(SUN, 100 / SUN.y);
  const r = clipOf(fit, receiver);
  const t = clipOf(fit, top);
  expect(onMap(t)).toBe(true);
  // the same texel, nearer the light
  expect(t.x).toBeCloseTo(r.x, 6);
  expect(t.y).toBeCloseTo(r.y, 6);
  expect(t.z).toBeLessThan(r.z);
});

test("the bias is a few decimetres of depth near the camera", () => {
  const v = view(150, 25);
  const fit = fitWarpedShadow(v, SUN);
  expect(fit).not.toBeNull();
  if (!fit) {
    return;
  }
  // depth units per metre along the sun's ray at the nearest receiver
  const p = ahead(v, fit.nearest);
  const a = clipOf(fit, p);
  const b = clipOf(fit, p.clone().addScaledVector(SUN, 1));
  // three's map holds depth in 0…1, half the clip space's −1…1
  const perMetre = Math.abs(b.z - a.z) / 2;
  expect(-fit.bias / perMetre).toBeGreaterThan(0.1);
  expect(-fit.bias / perMetre).toBeLessThan(0.3);
});

test("the map stands while the view stays inside its margin", () => {
  const v = view(150, 25);
  const fit = fitWarpedShadow(v, SUN);
  expect(fit).not.toBeNull();
  if (!fit) {
    return;
  }
  expect(warpCovers(fit, v)).toBe(true);
  // a few degrees round, a little on: the same map
  expect(warpCovers(fit, view(150, 25, 6))).toBe(true);
  expect(warpCovers(fit, view(150, 30))).toBe(true);
  const on = view(150, 25);
  on.eye.add(new Vector3(0, 0, -100));
  expect(warpCovers(fit, on)).toBe(true);
  // turned away, or dived to the ground: fitted anew
  expect(warpCovers(fit, view(150, 25, 45))).toBe(false);
  expect(warpCovers(fit, view(40, 25))).toBe(false);
});

test("the warp's matrix is invertible and keeps w positive on the body", () => {
  const v = view(200, 30, 70);
  const fit = fitWarpedShadow(v, SUN);
  expect(fit).not.toBeNull();
  if (!fit) {
    return;
  }
  expect(fit.warp.determinant()).not.toBe(0);
  const inverse = new Matrix4().copy(fit.clip).invert();
  const p = ahead(v, 700);
  const back = clipOf(fit, p).applyMatrix4(inverse);
  expect(back.distanceTo(p)).toBeLessThan(0.05);
});
