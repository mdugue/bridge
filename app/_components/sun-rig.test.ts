import { expect, test } from "bun:test";
import { Box3, DirectionalLight, Scene, Vector3 } from "three";
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

test("the map is marked for redraw once at construction", () => {
  const { sunRig, sun } = rig();
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(sun.shadow.autoUpdate).toBe(false);
  expect(sunRig.shadowPending()).toBe(true);
});

test("follow inside the dead zone does not redraw", () => {
  const { sunRig, sun } = rig();
  sunRig.follow(new Vector3(0, 100, 0)); // first call re-centres
  expect(sun.shadow.needsUpdate).toBe(true);
  sun.shadow.needsUpdate = false;
  for (const p of [
    new Vector3(5, 100, 0),
    new Vector3(0, 100, 19),
    new Vector3(-10, 105, 10),
  ]) {
    sunRig.follow(p);
    expect(sun.shadow.needsUpdate).toBe(false);
    expect(sunRig.shadowPending()).toBe(false);
  }
});

test("follow beyond the dead zone re-centres and redraws", () => {
  const { sunRig, sun } = rig();
  sunRig.follow(new Vector3(0, 100, 0));
  sun.shadow.needsUpdate = false;
  sunRig.follow(new Vector3(25, 100, 0));
  expect(sun.shadow.needsUpdate).toBe(true);
  // Snapped to the texel grid: within one texel (0.07 m at 3072²) of the point.
  expect(sun.target.position.distanceTo(new Vector3(25, 100, 0))).toBeLessThan(
    0.1
  );
  // A purely vertical move (fly mode, straight up) redraws as well.
  sun.shadow.needsUpdate = false;
  sunRig.follow(new Vector3(25, 125, 0));
  expect(sun.shadow.needsUpdate).toBe(true);
});

test("the shadow map takes the size it is given (lite = 512²)", () => {
  const { sunRig, sun } = rig(512);
  expect(sun.shadow.mapSize.x).toBe(512);
  expect(sunRig.shadowMapBytes).toBe(512 * 512 * 4);
  // Coarser texel (0.43 m over the 220 m frustum): the re-centre still snaps
  // to it, so the frustum lands within one texel of the point.
  sunRig.follow(new Vector3(0, 100, 0));
  sunRig.follow(new Vector3(25, 100, 0));
  expect(sun.target.position.distanceTo(new Vector3(25, 100, 0))).toBeLessThan(
    0.45
  );
});

test("the sun moving always redraws", () => {
  const { sunRig, sun } = rig();
  sunRig.follow(new Vector3(0, 100, 0));
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
