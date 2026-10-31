import { expect, jest, test } from "bun:test";
import {
  Box3,
  Color,
  type DepthTexture,
  DirectionalLight,
  PerspectiveCamera,
  RenderTarget,
  Scene,
  type ShadowNode,
  Vector3,
  Vector4,
} from "three/webgpu";
import { uniform } from "three/tsl";
import { SHADOW_BASE_RADIUS, SHADOW_MAX_RADIUS } from "@/lib/city/shadow-fit";
import { shadowMapSizeFor } from "./scene-profile";
import { type AirView, createSunRig } from "./sun-rig";

// Dresden — the primary tile's latitude/longitude.
const DRESDEN = { lat: 51.05, lng: 13.74 };

function rig(shadowMapSize = shadowMapSizeFor("full")) {
  const scene = new Scene();
  const bounds = new Box3(
    new Vector3(-1000, 0, -1000),
    new Vector3(1000, 300, 1000)
  );
  const fogColor = uniform(new Color());
  const sunRig = createSunRig(
    scene,
    bounds,
    DRESDEN,
    shadowMapSize,
    undefined,
    fogColor
  );
  const sun = scene.children.find(
    (o) => o instanceof DirectionalLight
  ) as DirectionalLight;
  return { sunRig, sun, fogColor };
}

/** Looking due north and level — the horizontal part of a world direction. */
const LEVEL_NORTH = new Vector3(0, 0, -1);

/** A site whose ground lies between 90 and 140 m, the fog ending at 2.6 km. */
const AIR: AirView = { fogEnd: 2600, groundLow: 90, groundHigh: 140 };

/** The walk/fly camera at `position`, looking along `direction`. */
function eyeAt(position: Vector3, direction: Vector3): PerspectiveCamera {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.3, 6000);
  camera.position.copy(position);
  if (Math.abs(direction.y) > 0.999) {
    // looking straight down: north is up on the screen
    camera.up.set(0, 0, -1);
  }
  camera.lookAt(position.clone().add(direction));
  camera.updateMatrixWorld();
  return camera;
}

/** follow() for a camera at `position` looking along `direction`. */
function followAt(
  sunRig: ReturnType<typeof createSunRig>,
  position: Vector3,
  direction: Vector3,
  ground: number
) {
  const d = direction.clone().normalize();
  sunRig.follow(eyeAt(position, d), d, ground, AIR);
}

/** Where the square the sun's camera streams for is centred (world). */
function squareCentre(sunRig: ReturnType<typeof createSunRig>): Vector3 {
  const cam = sunRig.shadowCamera as PerspectiveCamera;
  const look = cam.getWorldDirection(new Vector3());
  const mid = (cam.near + cam.far) / 2;
  return new Vector3()
    .setFromMatrixPosition(cam.matrixWorld)
    .addScaledVector(look, mid);
}

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
  followAt(sunRig, new Vector3(x, ground + 1.7, z), LEVEL_NORTH, ground);
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
  walkTo(sunRig, 35, 0);
  expect(sun.shadow.needsUpdate).toBe(true);
  // Snapped to the texel grid: within one texel (0.08 m at 3072²) of the
  // point, and anchored to the GROUND rather than to the eye.
  expect(sun.target.position.distanceTo(new Vector3(35, 100, 0))).toBeLessThan(
    0.1
  );
});

test("walking 500 m straight redraws the map once every 30 m", () => {
  const { sunRig, sun } = rig();
  let redraws = 0;
  for (let x = 0; x <= 500; x += 0.25) {
    sun.shadow.needsUpdate = false;
    walkTo(sunRig, x, 0);
    if (sun.shadow.needsUpdate) {
      redraws++;
    }
  }
  // the first re-centre and one per 30 m (26 with the old 19.8 m zone)
  expect(redraws).toBe(1 + Math.floor(500 / 30));
});

test("turning on the spot at eye level never moves the frustum", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  const centre = sun.target.position.clone();
  sun.shadow.needsUpdate = false;
  for (let deg = 0; deg < 360; deg += 15) {
    const a = (deg * Math.PI) / 180;
    // level, and pitched down by 30°
    for (const pitch of [0, -Math.PI / 6]) {
      const dir = new Vector3(
        Math.sin(a) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(a) * Math.cos(pitch)
      );
      followAt(sunRig, new Vector3(0, 101.7, 0), dir, 100);
    }
  }
  expect(sun.shadow.needsUpdate).toBe(false);
  expect(sun.target.position).toEqual(centre);
});

test("climbing straight up re-fits the stream's square and redraws", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  const square = sunRig.shadowCamera as unknown as {
    far: number;
    near: number;
    right: number;
  };
  const half = () => square.right;
  expect(half()).toBe(SHADOW_BASE_RADIUS);
  expect(sun.shadow.camera.right).toBe(SHADOW_BASE_RADIUS);
  sun.shadow.needsUpdate = false;
  // 110 m above the same spot, looking level: the square grows an octave and
  // the map redraws even though x/z never changed.
  followAt(sunRig, new Vector3(0, 210, 0), LEVEL_NORTH, 100);
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(half()).toBeGreaterThan(SHADOW_BASE_RADIUS);
  expect(half()).toBeLessThanOrEqual(SHADOW_MAX_RADIUS);
  // The square's depth range keeps its 1.2x margin around the light
  // distance, so the widened frustum still brackets the ground it covers.
  expect(square.near).toBeCloseTo(half() * 2 - half() * 1.2, 5);
  expect(square.far).toBeCloseTo(half() * 2 + half() * 1.2, 5);
  // Back down to eye level: the tight street-level frustum returns, and the
  // map is the square again.
  walkTo(sunRig, 0, 0);
  expect(half()).toBe(SHADOW_BASE_RADIUS);
  expect(sun.shadow.camera.right).toBe(SHADOW_BASE_RADIUS);
});

test("airborne, the square is pushed toward what the camera looks at", () => {
  const { sunRig } = rig();
  // 300 m up, looking level to the north: the square's centre must lead the
  // camera along -Z instead of sitting under it, and sit ON the ground.
  followAt(sunRig, new Vector3(0, 400, 0), LEVEL_NORTH, 100);
  expect(squareCentre(sunRig).z).toBeLessThan(-50);
  expect(squareCentre(sunRig).y).toBeCloseTo(100, 0);
  // Looking straight down from the same spot, the horizontal part of the view
  // direction vanishes and the square centres under the camera again.
  followAt(sunRig, new Vector3(0, 400, 0), new Vector3(0, -1, 0), 100);
  expect(Math.abs(squareCentre(sunRig).z)).toBeLessThan(1);
});

test("the shadow map is its depth alone, no colour target beside it", () => {
  const { sun } = rig(512);
  // reason: three reads the light's shadow node from an undeclared member
  const node = (sun.shadow as unknown as { shadowNode?: ShadowNode })
    .shadowNode as unknown as {
    setupRenderTarget: (
      shadow: unknown,
      builder: unknown
    ) => { depthTexture: DepthTexture; shadowMap: RenderTarget };
  };
  expect(node).toBeDefined();
  // the two members of a node builder the base reads
  const { shadowMap, depthTexture } = node.setupRenderTarget(sun.shadow, {
    renderer: { reversedDepthBuffer: false },
    createRenderTarget: (width: number, height: number) =>
      new RenderTarget(width, height),
  });
  expect(shadowMap.textures).toHaveLength(0);
  // the depth the PCF filter compares against is still the map's
  expect(shadowMap.depthTexture).toBe(depthTexture);
  // and it is this map's own, freed with it (three frees a target's depth
  // only where the texture names that target)
  expect(depthTexture.renderTarget).toBe(shadowMap);
  expect(shadowMap.width).toBe(512);
  shadowMap.dispose();
});

test("the shadow map takes the size it is given (lite = 512²)", () => {
  const { sunRig, sun } = rig(512);
  expect(sun.shadow.mapSize.x).toBe(512);
  // the depth's four bytes
  expect(sunRig.shadowMapBytes).toBe(512 * 512 * 4);
  // Coarser texel (0.47 m over the 242 m frustum): the re-centre still snaps
  // to it, so the frustum lands within one texel of the point.
  walkTo(sunRig, 0, 0);
  walkTo(sunRig, 35, 0);
  expect(sun.target.position.distanceTo(new Vector3(35, 100, 0))).toBeLessThan(
    0.48
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
  } as unknown as RenderTarget;
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

test("the palette's fog colour lands in the scene fog's uniform", () => {
  const { sunRig, fogColor } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00Z"));
  const noon = fogColor.value.getHex();
  expect(noon).not.toBe(0);
  // It follows the palette through the day, not only its first colour.
  sunRig.update(new Date("2026-06-21T19:30:00Z"));
  expect(fogColor.value.getHex()).not.toBe(noon);
});

// three keys every material's build by the lights it draws with: a sun that
// left the scene at dusk rebuilt every material on screen. It stays, dark,
// and by night its map is never asked for.
test("the sun stays in the scene by night, dark and without a shadow pass", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-12-21T23:00:00+01:00"));
  expect(sun.visible).toBe(true);
  expect(sun.intensity).toBe(0);
  expect(sunRig.shadowPending()).toBe(false);
  sunRig.invalidateShadow();
  walkTo(sunRig, 800, 0);
  expect(sunRig.shadowPending()).toBe(false);
  sunRig.update(new Date("2026-06-21T12:00:00+02:00"));
  expect(sun.visible).toBe(true);
  expect(sunRig.shadowPending()).toBe(true);
});

// The shadow camera is a streaming camera: a frustum left behind keeps its
// tiles loaded. three updates it only while drawing the shadow, which by
// night it never does.
for (const [when, date] of [
  ["by night", "2026-12-21T23:00:00+01:00"],
  ["by day", "2026-06-21T12:00:00+02:00"],
] as const) {
  test(`the shadow camera follows the player ${when}`, () => {
    const { sunRig } = rig();
    sunRig.update(new Date(date));
    walkTo(sunRig, 0, 0);
    const before = new Vector3().setFromMatrixPosition(
      sunRig.shadowCamera.matrixWorld
    );
    walkTo(sunRig, 800, 0);
    const after = new Vector3().setFromMatrixPosition(
      sunRig.shadowCamera.matrixWorld
    );
    expect(after.x - before.x).toBeGreaterThan(700);
  });
}

// A drag through the day turns the sun at every frame; the map, the
// heaviest pass, follows ten times a second and at once when it ends.
test("a drag's steps redraw the shadow map at most every 100 ms", () => {
  jest.useFakeTimers();
  try {
    const { sunRig, sun } = rig();
    sunRig.update(new Date("2026-06-21T12:00:00+02:00"));
    expect(sunRig.shadowPending()).toBe(true);
    sun.shadow.needsUpdate = false; // three drew it
    sunRig.update(new Date("2026-06-21T12:05:00+02:00"), true);
    expect(sunRig.shadowPending()).toBe(false);
    jest.advanceTimersByTime(99);
    expect(sunRig.shadowPending()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(sunRig.shadowPending()).toBe(true);
    sun.shadow.needsUpdate = false;
    sunRig.update(new Date("2026-06-21T12:10:00+02:00"), true);
    sunRig.update(new Date("2026-06-21T12:15:00+02:00"));
    expect(sunRig.shadowPending()).toBe(true);
    sunRig.dispose();
  } finally {
    jest.useRealTimers();
  }
});

/** Where a world point lands on the shadow map (x, y in 0…1 on it). */
function onMap(sun: DirectionalLight, p: Vector3): { x: number; y: number } {
  const q = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(sun.shadow.matrix);
  return { x: q.x / q.w, y: q.y / q.w };
}

const inside = ({ x, y }: { x: number; y: number }) =>
  x >= 0 && x <= 1 && y >= 0 && y <= 1;

/** 150 m over the ground, looking north and 25° down. */
const FLYING = new Vector3(0, 250, 0);
const LOOK = new Vector3(0, -Math.sin(Math.PI / 7.2), -Math.cos(Math.PI / 7.2));

test("from the air the map is warped over the view, out to the fog", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  followAt(sunRig, FLYING, LOOK, 100);
  // the square of old reached ~600 m ahead; the warped map reaches the
  // ground 1.8 km out, and still holds the ground under the view's bottom
  for (const z of [-200, -600, -1200, -1800]) {
    expect(inside(onMap(sun, new Vector3(0, 100, z)))).toBe(true);
  }
  // behind the camera, out of view, it holds nothing
  expect(inside(onMap(sun, new Vector3(0, 100, 600)))).toBe(false);
  // the stream's square is the one it was
  expect((sunRig.shadowCamera as unknown as { right: number }).right).toBe(440);
  // the horizon's near band takes over where the map ends
  expect(sunRig.shadowReach.z).toBeGreaterThan(1800);
});

test("turning a little from the air keeps the map; turning on redraws it", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  followAt(sunRig, FLYING, LOOK, 100);
  expect(sun.shadow.needsUpdate).toBe(true);
  sun.shadow.needsUpdate = false;
  const turned = (deg: number) =>
    LOOK.clone().applyAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180);
  followAt(sunRig, FLYING, turned(6), 100);
  followAt(sunRig, FLYING.clone().add(new Vector3(5, 0, -40)), LOOK, 100);
  expect(sun.shadow.needsUpdate).toBe(false);
  followAt(sunRig, FLYING, turned(40), 100);
  expect(sun.shadow.needsUpdate).toBe(true);
});

test("the sun moving fits the warp to it anew", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  followAt(sunRig, FLYING, LOOK, 100);
  const before = sun.shadow.matrix.clone();
  sun.shadow.needsUpdate = false;
  sunRig.update(new Date("2026-06-21T15:00:00+02:00"));
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(sun.shadow.matrix.equals(before)).toBe(false);
  expect(inside(onMap(sun, new Vector3(0, 100, -1200)))).toBe(true);
});

test("landing, and Modell, give the map back to the square", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  followAt(sunRig, FLYING, LOOK, 100);
  expect(sun.shadow.camera.right).not.toBe(440);
  // 25 m up is still in the air (the switch has a hysteresis) …
  followAt(sunRig, new Vector3(0, 125, 0), LOOK, 100);
  expect(sun.shadow.camera.right).not.toBe(SHADOW_BASE_RADIUS);
  // … on the ground it is the walker's square
  sun.shadow.needsUpdate = false;
  walkTo(sunRig, 0, 0);
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(sun.shadow.camera.right).toBe(SHADOW_BASE_RADIUS);
  expect(sun.shadow.bias).toBe(-0.0003);
  // Modell fits the square to its picture
  followAt(sunRig, FLYING, LOOK, 100);
  sunRig.followFootprint(0, 100, -300, 200, 880);
  expect(sun.shadow.camera.right).toBe(sun.shadow.camera.top);
  expect(inside(onMap(sun, new Vector3(0, 100, -300)))).toBe(true);
});
