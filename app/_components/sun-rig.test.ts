import { expect, test } from "bun:test";
import {
  Box3,
  DirectionalLight,
  Scene,
  Vector3,
  type WebGLRenderTarget,
} from "three";
import { SHADOW_BASE_RADIUS, SHADOW_MAX_RADIUS } from "@/lib/city/shadow-fit";
import { shadowMapSizeFor } from "./scene-profile";
import { createSunRig } from "./sun-rig";

// Dresden — the primary tile's latitude/longitude.
const DRESDEN = { lat: 51.05, lng: 13.74 };

function rig(shadowMapSize = shadowMapSizeFor("full")) {
  const scene = new Scene();
  const bounds = new Box3(
    new Vector3(-1000, 0, -1000),
    new Vector3(1000, 300, 1000)
  );
  const sunRig = createSunRig(scene, bounds, DRESDEN, shadowMapSize);
  const sun = scene.children.find(
    (o) => o instanceof DirectionalLight
  ) as DirectionalLight;
  return { sunRig, sun };
}

/** Looking due north and level — the horizontal part of a world direction. */
const LEVEL_NORTH = new Vector3(0, 0, -1);

/**
 * follow() at eye height above ground: the base-radius case, i.e. everything
 * the rig did before the frustum learned to grow.
 */
function walkTo(
  sunRig: ReturnType<typeof createSunRig>,
  x: number,
  z: number,
  ground = 100
) {
  sunRig.follow(new Vector3(x, ground + 1.7, z), LEVEL_NORTH, ground);
}

test("the map is marked for redraw once at construction", () => {
  const { sunRig, sun } = rig();
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(sun.shadow.autoUpdate).toBe(false);
  expect(sunRig.shadowPending()).toBe(true);
});

test("follow inside the dead zone does not redraw", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0); // first call re-centres
  expect(sun.shadow.needsUpdate).toBe(true);
  sun.shadow.needsUpdate = false;
  for (const [x, z] of [
    [5, 0],
    [0, 19],
    [-10, 10],
  ]) {
    walkTo(sunRig, x, z);
    expect(sun.shadow.needsUpdate).toBe(false);
    expect(sunRig.shadowPending()).toBe(false);
  }
});

test("follow beyond the dead zone re-centres and redraws", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  sun.shadow.needsUpdate = false;
  walkTo(sunRig, 25, 0);
  expect(sun.shadow.needsUpdate).toBe(true);
  // Snapped to the texel grid: within one texel (0.07 m at 3072²) of the
  // point, and anchored to the GROUND rather than to the eye.
  expect(sun.target.position.distanceTo(new Vector3(25, 100, 0))).toBeLessThan(
    0.1
  );
});

test("climbing straight up re-fits the frustum and redraws", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  const half = () => sun.shadow.camera.right;
  expect(half()).toBe(SHADOW_BASE_RADIUS);
  sun.shadow.needsUpdate = false;
  // 110 m above the same spot, looking level: the frustum grows an octave and
  // the map redraws even though x/z never changed.
  sunRig.follow(new Vector3(0, 210, 0), LEVEL_NORTH, 100);
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(half()).toBeGreaterThan(SHADOW_BASE_RADIUS);
  expect(half()).toBeLessThanOrEqual(SHADOW_MAX_RADIUS);
  // The shadow camera's depth range keeps its 1.2x margin around the light
  // distance, so the widened frustum still brackets the ground it covers.
  const cam = sun.shadow.camera;
  expect(cam.near).toBeCloseTo(half() * 2 - half() * 1.2, 5);
  expect(cam.far).toBeCloseTo(half() * 2 + half() * 1.2, 5);
  // Back down to eye level: the tight street-level frustum returns.
  walkTo(sunRig, 0, 0);
  expect(half()).toBe(SHADOW_BASE_RADIUS);
});

test("airborne, the frustum is pushed toward what the camera looks at", () => {
  const { sunRig, sun } = rig();
  // 300 m up, looking level to the north: the frustum centre must lead the
  // camera along -Z instead of sitting under it, and sit ON the ground.
  sunRig.follow(new Vector3(0, 400, 0), LEVEL_NORTH, 100);
  expect(sun.target.position.z).toBeLessThan(-50);
  expect(sun.target.position.y).toBeCloseTo(100, 0);
  // Looking straight down from the same spot, the horizontal part of the view
  // direction vanishes and the frustum centres under the camera again.
  sunRig.follow(new Vector3(0, 400, 0), new Vector3(0, -1, 0), 100);
  expect(Math.abs(sun.target.position.z)).toBeLessThan(1);
});

test("the shadow map takes the size it is given (lite = 512²)", () => {
  const { sunRig, sun } = rig(512);
  expect(sun.shadow.mapSize.x).toBe(512);
  expect(sunRig.shadowMapBytes).toBe(512 * 512 * 4);
  // Coarser texel (0.43 m over the 220 m frustum): the re-centre still snaps
  // to it, so the frustum lands within one texel of the point.
  walkTo(sunRig, 0, 0);
  walkTo(sunRig, 25, 0);
  expect(sun.target.position.distanceTo(new Vector3(25, 100, 0))).toBeLessThan(
    0.45
  );
});

test("the sun moving always redraws", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  sun.shadow.needsUpdate = false;
  sunRig.update(new Date("2026-06-21T10:00:00Z"));
  expect(sun.shadow.needsUpdate).toBe(true);
});

test("invalidateShadow redraws", () => {
  const { sunRig, sun } = rig();
  sun.shadow.needsUpdate = false;
  sunRig.invalidateShadow();
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(sunRig.shadowPending()).toBe(true);
});

test("dispose frees the shadow map and is safe before any render", () => {
  const { sunRig, sun } = rig();
  expect(() => sunRig.dispose()).not.toThrow();
  let calls = 0;
  // reason: the rig only needs the one method of the render target it frees
  sun.shadow.map = {
    dispose: () => {
      calls += 1;
    },
  } as unknown as WebGLRenderTarget;
  sunRig.dispose();
  expect(calls).toBe(1);
});

test("nightFactor ramps across civil dusk", () => {
  const { sunRig } = rig();
  const noon = sunRig.update(new Date("2026-06-21T12:00:00Z"));
  expect(noon.nightFactor).toBe(0);
  expect(noon.aboveHorizon).toBe(true);
  expect(noon.altitudeDeg).toBeGreaterThan(55);
  const night = sunRig.update(new Date("2026-06-21T23:30:00Z"));
  expect(night.nightFactor).toBe(1);
  expect(night.aboveHorizon).toBe(false);
});
