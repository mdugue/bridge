import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import {
  Box3,
  Color,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  RenderTarget,
  Scene,
  Vector3,
  Vector4,
} from "three/webgpu";
import type { DepthTexture, Matrix4, ShadowNode } from "three/webgpu";
import { uniform } from "three/tsl";
import { SHADOW_BASE_RADIUS, SHADOW_MAX_RADIUS } from "@/lib/city/shadow-fit";
import { SHADOW_RINGS } from "@/lib/city/shadow-rings";
import { shadowMapSizeFor } from "./scene-profile";
import { createSunRig } from "./sun-rig";
import { castsInRing, markThinCaster } from "./three-utils";

// A ring's redraws are paced by the clock, and these tests step through time.
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

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
    (o): o is DirectionalLight => o instanceof DirectionalLight
  );
  if (!sun) {
    throw new Error("the rig adds no sun");
  }
  return { sunRig, sun, fogColor };
}

/** Looking due north and level — the horizontal part of a world direction. */
const LEVEL_NORTH = new Vector3(0, 0, -1);

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
  sunRig.follow(eyeAt(position, d), d, ground);
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

/** The rings' shadow node, as three draws with it. */
function ringNode(sun: DirectionalLight) {
  // reason: three reads the light's shadow node from an undeclared member,
  // and renderShadow is ShadowNode's documented override
  return (sun.shadow as unknown as { shadowNode: ShadowNode })
    .shadowNode as unknown as {
    renderShadow: (frame: unknown) => void;
    shadowMap: RenderTarget | null;
  };
}

/** What three does in a frame with a ring due: draws one layer. Returns it,
 *  or null when none was due. */
function drawOne(
  sun: DirectionalLight,
  seen?: { thin: boolean }
): number | null {
  const node = ringNode(sun);
  node.shadowMap ??= new RenderTarget(4, 4);
  const layers: number[] = [];
  // three's own: it draws what reaches it
  let drawObject: (object: unknown) => void = () => {
    if (seen) {
      seen.thin = true;
    }
  };
  node.renderShadow({
    scene: new Scene(),
    renderer: {
      getRenderObjectFunction: () => drawObject,
      render: () => {
        drawObject({ userData: { casterRings: 1 } });
      },
      setRenderObjectFunction: (f: (object: unknown) => void) => {
        drawObject = f;
      },
      setRenderTarget: (_target: unknown, at: number) => {
        layers.push(at);
      },
    },
  });
  sun.shadow.needsUpdate = false;
  return layers[0] ?? null;
}

/** Draws every ring that is asked for, across as many frames as they take. */
function drawAll(sun: DirectionalLight): number[] {
  const layers: number[] = [];
  for (let frame = 0; frame < 16; frame += 1) {
    jest.advanceTimersByTime(1000);
    const layer = drawOne(sun);
    if (layer !== null) {
      layers.push(layer);
    }
  }
  return layers;
}

test("follow inside every dead zone does not redraw", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0); // first call places the rings
  expect(sun.shadow.needsUpdate).toBe(true);
  drawAll(sun);
  for (const [x, z] of [
    [5, 0],
    [0, 12],
    [-10, 10],
  ]) {
    walkTo(sunRig, x, z);
    expect(sun.shadow.needsUpdate).toBe(false);
    expect(sunRig.shadowPending()).toBe(false);
  }
});

test("past its dead zone the finest ring redraws, on the ground", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  walkTo(sunRig, 20, 0);
  expect(sun.shadow.needsUpdate).toBe(true);
  // the wider rings are still where they were
  expect(drawAll(sun)).toEqual([0]);
  // Snapped to its texel grid: within one texel (0.08 m at 2048²) of the
  // point, and anchored to the GROUND rather than to the eye.
  expect(sun.target.position.distanceTo(new Vector3(20, 100, 0))).toBeLessThan(
    0.1
  );
});

test("walking on, each ring redraws in proportion to its size", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  const redraws = [0, 0, 0, 0];
  for (let x = 0; x <= 2000; x += 1) {
    jest.advanceTimersByTime(1000);
    walkTo(sunRig, x, 0);
    const layer = drawOne(sun);
    if (layer !== null) {
      redraws[layer] += 1;
    }
  }
  expect(redraws).toEqual([125, 41, 13, 4]);
});

test("turning on the spot at eye level draws no ring", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  const centre = sun.target.position.clone();
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

test("climbing straight up re-fits the stream's square", () => {
  const { sunRig } = rig();
  walkTo(sunRig, 0, 0);
  const square = sunRig.shadowCamera as unknown as {
    far: number;
    near: number;
    right: number;
  };
  const half = () => square.right;
  expect(half()).toBe(SHADOW_BASE_RADIUS);
  // 110 m above the same spot, looking level: the square grows an octave
  followAt(sunRig, new Vector3(0, 210, 0), LEVEL_NORTH, 100);
  expect(half()).toBeGreaterThan(SHADOW_BASE_RADIUS);
  expect(half()).toBeLessThanOrEqual(SHADOW_MAX_RADIUS);
  // The square's depth range keeps its 1.2x margin around the light
  // distance, so the widened frustum still brackets the ground it covers.
  expect(square.near).toBeCloseTo(half() * 2 - half() * 1.2, 5);
  expect(square.far).toBeCloseTo(half() * 2 + half() * 1.2, 5);
  // Back down to eye level: the tight street-level frustum returns.
  walkTo(sunRig, 0, 0);
  expect(half()).toBe(SHADOW_BASE_RADIUS);
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

test("the shadow map is its depth alone, one layer a ring", () => {
  const { sun } = rig(512);
  const node = ringNode(sun) as unknown as {
    setupRenderTarget: (
      shadow: unknown,
      builder: unknown
    ) => { depthTexture: DepthTexture; shadowMap: RenderTarget };
  };
  const { shadowMap, depthTexture } = node.setupRenderTarget(sun.shadow, {
    renderer: { reversedDepthBuffer: false },
  });
  expect(shadowMap.textures).toHaveLength(0);
  // the depth the PCF filter compares against is still the map's
  expect(shadowMap.depthTexture).toBe(depthTexture);
  // and it is this map's own, freed with it (three frees a target's depth
  // only where the texture names that target)
  expect(depthTexture.renderTarget).toBe(shadowMap);
  expect(depthTexture.isArrayTexture).toBe(true);
  expect(shadowMap.depth).toBe(SHADOW_RINGS);
  expect(shadowMap.width).toBe(512);
  shadowMap.dispose();
});

test("the rings take the size they are given", () => {
  const { sunRig, sun } = rig(512);
  expect(sun.shadow.mapSize.x).toBe(512);
  // four layers of the depth's four bytes
  expect(sunRig.shadowMapBytes).toBe(512 * 512 * 4 * SHADOW_RINGS);
  // Coarser texel (0.31 m over the finest ring's 160 m): a re-centre still
  // snaps to it, so the ring lands within one texel of the point.
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  walkTo(sunRig, 35, 0);
  drawAll(sun);
  expect(sun.target.position.distanceTo(new Vector3(35, 100, 0))).toBeLessThan(
    0.32
  );
});

test("a change far off asks only the rings it can fall on", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T12:00:00+02:00"));
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  sunRig.invalidateShadow({ maxX: 1700, maxZ: 1200, minX: 1500, minZ: 1000 });
  expect(drawAll(sun)).toEqual([3]);
  // and under the camera, all of them
  sunRig.invalidateShadow({ maxX: 10, maxZ: 10, minX: -10, minZ: -10 });
  expect(drawAll(sun).toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3]);
});

test("a change of the crowns' tiers leaves the finest ring alone", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  sunRig.invalidateCrowns();
  expect(drawAll(sun).toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
});

test("a thin caster showing or hiding leaves the widest ring alone", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  sunRig.invalidateThin();
  expect(drawAll(sun).toSorted((a, b) => a - b)).toEqual([0, 1, 2]);
});

test("the sun moving redraws every ring", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  sunRig.update(new Date("2026-06-21T10:00:00Z"));
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(drawAll(sun).toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3]);
});

test("invalidateShadow redraws every ring, one a frame", () => {
  const { sunRig, sun } = rig();
  walkTo(sunRig, 0, 0);
  drawAll(sun);
  expect(sunRig.shadowBusy()).toBe(false);
  sunRig.invalidateShadow();
  expect(sun.shadow.needsUpdate).toBe(true);
  expect(sunRig.shadowPending()).toBe(true);
  expect(sunRig.shadowBusy()).toBe(true);
  expect(drawOne(sun)).toBe(0);
  expect(sunRig.shadowBusy()).toBe(true);
  expect(drawAll(sun).toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
  expect(sunRig.shadowBusy()).toBe(false);
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

/** Where a world point lands on a ring (x, y in 0…1 on it). */
function onRing(m: Matrix4, p: Vector3): { x: number; y: number } {
  const q = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(m);
  return { x: q.x / q.w, y: q.y / q.w };
}

const inside = ({ x, y }: { x: number; y: number }) =>
  x >= 0 && x <= 1 && y >= 0 && y <= 1;

/** 150 m over the ground, looking north and 25° down. */
const FLYING = new Vector3(0, 250, 0);
const LOOK = new Vector3(0, -Math.sin(Math.PI / 7.2), -Math.cos(Math.PI / 7.2));

function rings(sunRig: ReturnType<typeof createSunRig>) {
  return sunRig.shadowMap.rings;
}

test("from the air the rings reach the ground out to the fog", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  followAt(sunRig, FLYING, LOOK, 100);
  drawAll(sun);
  const widest = rings(sunRig).matrix[SHADOW_RINGS - 1].value;
  for (const z of [-200, -600, -1200, -1800]) {
    expect(inside(onRing(widest, new Vector3(0, 100, z)))).toBe(true);
  }
  // the stream's square is the one it was
  expect((sunRig.shadowCamera as unknown as { right: number }).right).toBe(440);
  // the horizon's near band takes over where the map ends
  expect(sunRig.shadowReach.z).toBe(2160);
});

// A map warped over the view lost its near texels at a low sun, looking
// along the light: ten times as wide, and the lamp posts' shadows gone.
test("a ring's texels do not depend on where the camera looks", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-11-04T14:00:00+01:00"));
  const across = new Vector3(sun.position.x, 0, sun.position.z);
  for (let deg = 0; deg < 360; deg += 30) {
    const look = LOOK.clone().applyAxisAngle(
      new Vector3(0, 1, 0),
      (deg * Math.PI) / 180
    );
    followAt(sunRig, new Vector3(0, 130, 0), look, 100);
    drawAll(sun);
    const matrix = rings(sunRig).matrix[0].value;
    const side = new Vector3(-across.z, 0, across.x).normalize();
    const a = onRing(matrix, new Vector3(0, 100, 0));
    const b = onRing(matrix, new Vector3(0, 100, 0).add(side));
    const texels = Math.hypot(b.x - a.x, b.y - a.y) * 2048;
    // a metre across the light: 12.8 texels of 0.078 m
    expect(texels).toBeCloseTo(12.8, 0);
  }
});

test("the finest rings go as the camera climbs, and are drawn no more", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  followAt(sunRig, new Vector3(0, 110, 0), LOOK, 100);
  drawAll(sun);
  expect(rings(sunRig).fade.map((f) => f.value)).toEqual([1, 1, 1, 1]);
  followAt(sunRig, new Vector3(0, 430, 0), LOOK, 100);
  expect(rings(sunRig).fade[0].value).toBe(0);
  expect(rings(sunRig).fade[1].value).toBe(1);
  drawAll(sun);
  sunRig.invalidateShadow();
  expect(drawAll(sun).toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
});

test("a ring back in view shows nothing until it is drawn anew", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  followAt(sunRig, new Vector3(0, 500, 0), LOOK, 100);
  drawAll(sun);
  followAt(sunRig, new Vector3(0, 280, 0), LOOK, 100);
  expect(rings(sunRig).fade[0].value).toBe(0);
  expect(sunRig.shadowBusy()).toBe(true);
  drawAll(sun);
  followAt(sunRig, new Vector3(0, 280, 0), LOOK, 100);
  expect(rings(sunRig).fade[0].value).toBeGreaterThan(0);
});

/** Which rings draw a caster of `kind`. */
const ringsDrawing = (kind: "slender" | "tiny") => {
  const object = new Object3D();
  markThinCaster(object, kind);
  return [0, 1, 2, 3].map((ring) => castsInRing(object, ring));
};

test("the rings draw a thin caster as far as its kind reaches", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  walkTo(sunRig, 0, 0);
  expect(ringsDrawing("tiny")).toEqual([true, false, false, false]);
  expect(ringsDrawing("slender")).toEqual([true, true, true, false]);
  expect(castsInRing(new Object3D(), 3)).toBe(true);
  // the ring's draw goes by it: the widest passes over a marked caster
  const finest = { thin: false };
  expect(drawOne(sun, finest)).toBe(0);
  expect(finest.thin).toBe(true);
  const next = { thin: false };
  expect(drawOne(sun, next)).toBe(1);
  expect(next.thin).toBe(false);
});

for (const [where, at] of [
  ["on foot", new Vector3(0, 101.7, 0)],
  ["from the air", FLYING],
] as const) {
  test(`a ring keeps its matrix until it is drawn again ${where}`, () => {
    const { sunRig, sun } = rig();
    sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
    followAt(sunRig, at, LOOK, 100);
    drawAll(sun);
    const drawn = rings(sunRig).matrix[0].value.clone();
    // the sun moves: the light turns with it at once …
    jest.advanceTimersByTime(1000);
    sunRig.update(new Date("2026-06-21T10:02:00+02:00"), true);
    expect(sun.shadow.needsUpdate).toBe(true);
    // … and a ring not yet drawn still reads what it drew, where it drew it
    expect(rings(sunRig).matrix[0].value.equals(drawn)).toBe(true);
    expect(drawOne(sun)).toBe(0);
    expect(rings(sunRig).matrix[0].value.equals(drawn)).toBe(false);
    sunRig.dispose();
  });
}

test("Modell tiles its picture's square with the four rings", () => {
  const { sunRig, sun } = rig();
  sunRig.update(new Date("2026-06-21T10:00:00+02:00"));
  sunRig.followFootprint(0, 100, -300, 200, 880);
  drawAll(sun);
  expect(rings(sunRig).fade.map((f) => f.value)).toEqual([1, 1, 1, 1]);
  // every corner of the square lies on a ring, and its middle on all of them
  const half = (sunRig.shadowCamera as unknown as { right: number }).right;
  for (const [x, z] of [
    [-half * 0.7, -300 - half * 0.7],
    [half * 0.7, -300 - half * 0.7],
    [-half * 0.7, -300 + half * 0.7],
    [half * 0.7, -300 + half * 0.7],
  ]) {
    const p = new Vector3(x, 100, z);
    expect(rings(sunRig).matrix.some((m) => inside(onRing(m.value, p)))).toBe(
      true
    );
  }
  const middle = new Vector3(0, 100, -300);
  expect(
    rings(sunRig).matrix.every((m) => inside(onRing(m.value, middle)))
  ).toBe(true);
  expect(sunRig.shadowReach.z).toBe(half);
  // the thin casters too: there is no finer ring to leave them to
  sunRig.invalidateShadow();
  const widest = { thin: false };
  for (let i = 0; i < SHADOW_RINGS; i += 1) {
    drawOne(sun, widest);
    jest.advanceTimersByTime(1000);
  }
  expect(widest.thin).toBe(true);
});
