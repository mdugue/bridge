import {
  Color,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  Vector3,
} from "three/webgpu";
import type {
  Box3,
  Camera,
  DepthTexture,
  NodeBuilder,
  PerspectiveCamera,
  UniformNode,
  WebGPURenderer,
} from "three/webgpu";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import {
  cameraPosition,
  dot,
  float,
  Fn,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { atmosphereAt } from "@/lib/city/atmosphere";
import { fitModelShadow } from "@/lib/city/model-view";
import {
  fitShadowRadius,
  SHADOW_BASE_RADIUS,
  shadowDeadZone,
  shadowFocusAhead,
} from "@/lib/city/shadow-fit";
import { sunDirectionWorld } from "@/lib/city/sun";
import { shadowMapBytesFor } from "./scene-profile";
import { createSkyReflection } from "./sky-reflection";
import type { RingArea, RingView } from "@/lib/city/shadow-rings";
import { createSunRings } from "./sun-rings";
import type { ShadowRingNodes } from "./sun-rings";
import type { V3, V4 } from "./shader-chunks";

export interface SunState {
  aboveHorizon: boolean;
  altitudeDeg: number;
  /** 0 (full day) → 1 (civil dusk and below): drives the street-lamp ignition */
  nightFactor: number;
}

/** smoothstep ramping 1→0 as x rises from edge0 to edge1 (edges may invert). */
function smoothstepDown(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** The night factor at a sun altitude (°): 0 by day, 1 from civil dusk
 *  (−6°) — what lights the lamps, and what the picture styles' nights
 *  follow (stylize-effect.ts, paper-scene.ts). */
export function nightFactorAt(altitudeDeg: number): number {
  return smoothstepDown(2, -6, altitudeDeg);
}

/** The sun's altitude (°) from its world direction's height. */
function altitudeOf(y: number): number {
  return (Math.asin(Math.min(Math.max(y, -1), 1)) * 180) / Math.PI;
}

/** Where the sun stands at `date` over `latLng`, without moving the rig:
 *  what the HUD shows for the instant it asked for. */
export function sunStateAt(
  date: Date,
  latLng: { lat: number; lng: number }
): SunState {
  const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
  const altitudeDeg = altitudeOf(d.y);
  return {
    aboveHorizon: d.y > 0,
    altitudeDeg,
    nightFactor: nightFactorAt(altitudeDeg),
  };
}

export interface SunRig {
  /** Frees the shadow map — a render target disposeObject3D never reaches. */
  dispose: () => void;
  /**
   * Re-fits the shadow rings to the camera (call per frame; sun-rings.ts,
   * lib/city/shadow-rings.ts), and the square the sun's camera streams for
   * (lib/city/shadow-fit.ts). `direction` is the camera's world direction
   * (NOT normalized in the horizontal plane: its cos(pitch) factor is what
   * aims them) and `groundY` the terrain elevation under the camera.
   */
  follow: (
    camera: PerspectiveCamera,
    direction: Vector3,
    groundY: number
  ) => void;
  /**
   * Re-fits the map to the ground a parallel view shows (Modell, plan 055):
   * the rings tile a square on the footprint's circle at its ground height,
   * its half-size in half-octave steps up to `max`
   * (lib/city/model-view.ts).
   */
  followFootprint: (
    x: number,
    groundY: number,
    z: number,
    radius: number,
    max: number
  ) => void;
  /**
   * Modell's parallel view has no sky: the dome is hidden and the
   * background is `paper` (the style's sheet); off, the sky and the
   * palette's background come back.
   */
  setParallel: (on: boolean, paper?: Color) => void;
  /** Asks every ring to redraw, or those `area` can fall on, or the `finest`
   * few. A ring is otherwise only redrawn when the sun or the ring moves
   * (autoUpdate is off), so scene-topology edits (demolish, a tile landing or
   * leaving) must call this or stale shadows linger. */
  invalidateShadow: (area?: RingArea, finest?: number) => void;
  /** The square round the view's ground the sun's camera streams for: the
   *  tile stream loads what it sees too, so a building behind the player
   *  still casts into the view. It draws nothing: the rings have a camera
   *  of their own. */
  shadowCamera: Camera;
  /** A ring still waits for its redraw (QA: a plate waits for all of them). */
  shadowBusy: () => boolean;
  /** GPU bytes of the shadow map: four layers of a 32-bit depth texture, no
   *  colour target, no mipmaps (scene-profile.ts `shadowMapBytesFor`). */
  shadowMapBytes: number;
  /** How far the map reaches on the ground, kept current: its centre in the
   *  data frame (x east, y north: world x, −z) and its half-size (z, m). The
   *  terrain reads it by reference (the horizon's near band, sky-light.ts). */
  shadowReach: Vector3;
  /** True when the next render will redraw a ring. */
  shadowPending: () => boolean;
  /**
   * The sun's shadow map as a post pass may read it: its depth array (null
   * until the first lit material made it) and the rings' uniforms. The
   * picture styles test a pixel's world point against it
   * (stylize-effect.ts): in the sun or not.
   */
  shadowMap: {
    depth: () => DepthTexture | null;
    rings: ShadowRingNodes;
  };
  /** Re-aims sun, sky dome, fog and fill light for the given instant. */
  update: (date: Date, preview?: boolean) => SunState;
}

const SUN_INTENSITY = 2.4;

/**
 * Least time (ms) between two shadow-map redraws while the time of day is
 * dragged: the map is the heaviest pass (every caster), and a drag turns
 * the sun at every frame. Ten a second keep the shadows moving with it; the
 * drag's end redraws at once.
 */
const PREVIEW_SHADOW_MS = 100;

/** What the rig drives on the sky dome. */
interface SkyDome {
  setHaze: (colour: string) => void;
  setSun: (direction: Vector3) => void;
}

function createSkyDome(scene: Scene): SkyDome & { mesh: SkyMesh } {
  const sky = new SkyMesh();
  // Inside the camera far plane (6000) but beyond the fog end.
  sky.scale.setScalar(4500);
  // The dome is a box ±2250 m around its centre, so it has to travel with
  // the camera: anchored at the origin (the spawn tile), a camera on the
  // far tiles (the Blaues Wunder is ~3 km out) stood outside it and saw the
  // bare clear colour where the sky should be. Its colour only reads the
  // direction from the camera, so re-centring changes nothing else. This
  // runs after culling (hence no culling) and before the model-view
  // matrix is taken from `matrixWorld`.
  sky.frustumCulled = false;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.setFromMatrixPosition(camera.matrixWorld);
    sky.updateMatrixWorld();
  };
  // Upstream workaround: SkyMesh pins the dome to the far plane by
  // `z = w`, depth 1, which a reversed depth buffer (create-app.ts) reads
  // as the NEAR plane: the dome, drawn without depth write after the
  // opaque clay, passed the depth test over everything and painted walls
  // and kerbs sky-blue. Under a reversed buffer the far plane is z = 0
  // (docs/rendering.md, "Workarounds for upstream bugs").
  const placed = sky.material.vertexNode as V4 | null;
  if (!placed) {
    throw new Error("SkyMesh no longer sets its vertexNode: drop the z = 0");
  }
  sky.material.vertexNode = Fn((builder: NodeBuilder) =>
    builder.renderer.reversedDepthBuffer
      ? vec4(placed.x, placed.y, float(0), placed.w)
      : placed
  )();
  // Moderate haze and a small Mie lobe: more of either blows the sky around
  // the sun (and with it half the horizon) out to flat white.
  sky.turbidity.value = 4.5;
  sky.rayleigh.value = 1.6;
  sky.mieCoefficient.value = 0.0025;
  // A tighter forward lobe: the glow stays around the sun instead of
  // whitening a quarter of the sky.
  sky.mieDirectionalG.value = 0.82;
  // SkyMesh's procedural clouds (multi-octave fbm, sun-tinted) drift on TSL
  // `time`. Softened toward pale watercolour washes (not cotton balls), and
  // slow — a barely-moving Dresden sky. Effectively free: the fbm only runs
  // on sky pixels (direction.y > 0).
  sky.cloudCoverage.value = 0.3;
  sky.cloudDensity.value = 0.3;
  sky.cloudSpeed.value = 0.0001;
  // Horizon haze. The physical sky knows no ground: below the horizon it
  // repeats its brightest horizon white, so past the site's last tile the
  // view ended on a hard cut from fogged terrain to near-white. The dome
  // blends into the scene's fog colour instead — fully below the horizon
  // (the "ground" beyond the data is haze), feathered a few degrees above
  // it — so the fogged terrain, the edge haze (height-fog.ts) and the sky
  // meet in one soft band. The colour is fed per update from the palette.
  // The band also covers the low sky where the cloud plane's projection
  // crowds the fbm into one sunlit sheet (SkyMesh's own cloud fade sits
  // inside its colour node, out of reach).
  const haze = uniform(new Color(0xdf_e7_ee));
  // reason: SkyMesh builds its colour node in the constructor.
  const inner = sky.material.colorNode as V4;
  sky.material.colorNode = Fn(() => {
    // Temper the dome first: untouched, its lower third reads as flat paper
    // white and its zenith as a synthetic cyan. A little less radiance and
    // chroma keeps it a pale watercolour wash.
    const raw = inner.rgb;
    const luma = dot(raw, vec3(0.2126, 0.7152, 0.0722));
    const tempered = mix(vec3(luma), raw, 0.8).mul(0.7);
    // Soft shoulder on the bright part (the glow around the sun), by
    // luminance so the hue survives: past the knee it rolls off instead of
    // clipping to white.
    const l = luma.mul(0.7);
    const over = max(l.sub(0.45), 0);
    const shouldered = tempered.mul(
      min(l, 0.45)
        .add(over.div(over.mul(1.5).add(1)))
        .div(max(l, 1e-4))
    );
    const direction = normalize(positionWorld.sub(cameraPosition));
    const band = float(1).sub(smoothstep(-0.03, 0.28, direction.y));
    const hazed: V3 = mix(
      shouldered,
      haze,
      band.mul(band).mul(float(3).sub(band.mul(2)))
    );
    return vec4(hazed, 1);
  })();
  scene.add(sky);
  return {
    mesh: sky,
    setHaze: (colour) => {
      haze.value.set(colour);
    },
    setSun: (d) => {
      sky.sunPosition.value.copy(d);
    },
  };
}

/**
 * Sun + atmosphere rig: directional light with an orthographic shadow camera
 * that follows the camera (see follow()), a physical sky dome fed the same sun direction,
 * and fog/hemisphere colors interpolated from the time-of-day palette so the
 * whole frame stays in tune with the slider. `worldBounds` is in scene
 * (Y-up) coordinates.
 */
export function createSunRig(
  scene: Scene,
  worldBounds: Box3,
  latLng: { lat: number; lng: number },
  /** A ring's edge in texels (scene-profile.ts `shadowMapSizeFor`): 2048
   * over the finest ring's 160 m ≈ 0.08 m/texel. The `lite` e2e profile
   * passes 256 and phones 900: under SwiftShader the depth pass is one of the
   * few costs that does not shrink with the canvas, and no headless assertion
   * depends on edge quality. A ring is redrawn when it has drifted, when the
   * sun moves, and on explicit invalidation; not per frame. */
  shadowMapSize: number,
  /** Optional shared vector the rig keeps in sync with the world sun direction
   * (surface→sun) so other materials (e.g. the crown shimmer) can read it. */
  sunDirectionOut: Vector3 | undefined,
  /** The scene fog's colour (height-fog.ts): it follows the palette. */
  fogColor: UniformNode<"color", Color>,
  /** Renders the sky's reflection map (sky-reflection.ts); without one
   *  (the unit tests) the map stays dark. */
  renderer?: WebGPURenderer
): SunRig {
  const center = worldBounds.getCenter(new Vector3());
  // The square the sun's camera streams for is not fixed: it starts at the
  // base radius (eye level) and grows with altitude, so a fly-over still
  // loads what casts into the view (lib/city/shadow-fit.ts owns the policy,
  // resizeFrustum below applies it). These derive from it.
  let radius = SHADOW_BASE_RADIUS;
  // Its camera sits twice its radius out, for a depth range round the ground.
  let shadowDistance = radius * 2;
  // Metres its centre may drift before it follows.
  let deadZone = shadowDeadZone(radius);

  const hemisphere = new HemisphereLight(0xbf_d4_e6, 0x4a_5a_3a, 0.7);
  scene.add(hemisphere);

  const sky = createSkyDome(scene);
  // The same dome once more, alone in a scene of its own: what glass,
  // gilding and fountain water mirror (sky-reflection.ts).
  const mirroredSky = new Scene();
  const mirrored = createSkyDome(mirroredSky);
  const reflection = renderer
    ? createSkyReflection(renderer, mirroredSky)
    : undefined;

  const sun = new DirectionalLight(0xff_f4_e0, SUN_INTENSITY);
  sun.castShadow = true;
  // Re-render a ring only when it actually moves or the sun changes, not
  // every frame. Huge win with tens of thousands of shadow-casting trees.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  // The sun stays in the scene by night, at intensity 0: three keys every
  // material's build by the lights it draws with, so a light that left the
  // scene at dusk rebuilt every material in view, inside the frame, at every
  // dusk and dawn. Below the horizon the map is simply never asked for.
  let sunUp = true;
  const rings = createSunRings(sun, shadowMapSize);
  /** Three draws a ring in the next render if one is due. */
  const askRings = () => {
    sun.shadow.needsUpdate = sunUp && rings.due();
  };
  const invalidateShadow = (area?: RingArea, finest?: number) => {
    rings.invalidate(area, finest);
    askRings();
  };
  let shadowAskedAt = Number.NEGATIVE_INFINITY;
  let shadowWait: ReturnType<typeof setTimeout> | null = null;
  const cancelShadowWait = () => {
    if (shadowWait !== null) {
      clearTimeout(shadowWait);
      shadowWait = null;
    }
  };
  // The square round the view's ground (shadow-fit.ts), the one the sun's
  // camera streams for (`shadowCamera`).
  const square = new OrthographicCamera();
  /**
   * Rebuilds the square for a new half-size. Everything that scales with
   * the radius lives here, so the rest of the rig only ever reads the four
   * `let`s above. Cheap: a projection matrix, no reallocation.
   */
  const resizeFrustum = (next: number) => {
    radius = next;
    shadowDistance = radius * 2;
    deadZone = shadowDeadZone(radius);
    square.left = -radius;
    square.right = radius;
    square.top = radius;
    square.bottom = -radius;
    // Its depth range only bounds which tiles it streams.
    square.near = shadowDistance - radius * 1.2;
    square.far = shadowDistance + radius * 1.2;
    square.updateProjectionMatrix();
  };
  resizeFrustum(radius);
  scene.add(sun, sun.target);

  // Current sun direction and the square's focus; reposition() places the
  // square from these so update() (time) and follow() (camera) share logic.
  const dir = new Vector3();
  {
    const d = sunDirectionWorld(new Date(0), latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    sunDirectionOut?.copy(dir);
  }
  const focus = center.clone();
  rings.reach.set(center.x, -center.z, radius);
  rings.setSun(dir);
  const lastCentre = new Vector3(Number.NaN, Number.NaN, Number.NaN);

  /** The square to the focus. The shadow camera of the stream: three updates
   *  a camera only while drawing with it, and this one it never draws with, so
   *  a stale frustum would keep its tiles loaded. */
  const reposition = () => {
    square.position.copy(focus).addScaledVector(dir, shadowDistance);
    square.lookAt(focus);
    square.updateMatrixWorld();
    lastCentre.copy(focus);
  };

  /** The square to a new size and centre, unless that lies inside its dead
   *  zone at an unchanged size. Its centre is anchored to the GROUND, not the
   *  camera. */
  const moveSquare = (next: number, x: number, y: number, z: number) => {
    if (
      next === radius &&
      Number.isFinite(lastCentre.x) &&
      Math.hypot(x - lastCentre.x, y - lastCentre.y, z - lastCentre.z) <
        deadZone
    ) {
      return;
    }
    if (next !== radius) {
      resizeFrustum(next);
    }
    focus.set(x, y, z);
    reposition();
  };

  /** Re-fits the square the sun's camera streams for. */
  const followSquare = (
    position: Vector3,
    direction: Vector3,
    groundY: number
  ) => {
    const nextRadius = fitShadowRadius(position.y - groundY, radius);
    // Push the centre along the view so the square sits where the camera is
    // looking. `direction` is deliberately NOT re-normalized in the horizontal
    // plane: its cos(pitch) factor collapses the offset to zero when looking
    // straight down, which is exactly what we want there.
    const ahead = shadowFocusAhead(nextRadius);
    const wantX = position.x + direction.x * ahead;
    const wantZ = position.z + direction.z * ahead;
    moveSquare(nextRadius, wantX, groundY, wantZ);
  };

  // kept between frames: these run in every one of them
  const footprint = { x: 0, y: 0, z: 0 };
  const ringView: RingView = {
    dirX: 0,
    dirZ: 0,
    eyeX: 0,
    eyeZ: 0,
    groundY: 0,
    height: 0,
  };
  const follow = (
    camera: PerspectiveCamera,
    direction: Vector3,
    groundY: number
  ) => {
    const { position } = camera;
    followSquare(position, direction, groundY);
    ringView.dirX = direction.x;
    ringView.dirZ = direction.z;
    ringView.eyeX = position.x;
    ringView.eyeZ = position.z;
    ringView.groundY = groundY;
    ringView.height = position.y - groundY;
    rings.setView(ringView);
    askRings();
  };

  const followFootprint = (
    x: number,
    groundY: number,
    z: number,
    footRadius: number,
    maxRadius: number
  ) => {
    const nextRadius = fitModelShadow(footRadius, radius, maxRadius);
    moveSquare(nextRadius, x, groundY, z);
    footprint.x = x;
    footprint.y = groundY;
    footprint.z = z;
    rings.setFootprint(footprint, radius);
    askRings();
  };

  let parallel = false;
  let palettePaper: Color | null = null;
  let paletteBackground = 0;
  const setParallel = (on: boolean, paper?: Color) => {
    parallel = on;
    sky.mesh.visible = !on;
    if (on && paper) {
      palettePaper = paper.clone();
    }
    if (scene.background instanceof Color) {
      if (on && palettePaper) {
        scene.background.copy(palettePaper);
      } else {
        scene.background.setHex(paletteBackground);
      }
    }
  };

  /** The stream's square and the rings to the sun as it stands (`dir`), and
   *  a redraw asked. Only here does the sun come up for the rings: a ring drawn
   *  before the light has turned would be drawn from under the ground. */
  const moveLight = () => {
    sunUp = dir.y > 0;
    reposition();
    rings.setSun(dir);
    askRings();
    shadowAskedAt = performance.now();
  };

  const update = (date: Date, preview = false): SunState => {
    const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    // every step, unlike the light: the sky and the drawn shading follow
    // smoothly, and nothing drawn from it is held to the shadow map
    sunDirectionOut?.copy(dir);
    const aboveHorizon = dir.y > 0;
    // The sun moved: redraw by day (a drag's or a glide's step at most every
    // PREVIEW_SHADOW_MS, the last after the wait); by night drop a request
    // still open. The light turns at once and each ring follows when it is
    // drawn, keeping the matrix it was drawn with until then: its shadows stay
    // on their casters, the wide rings a little behind the fine ones.
    if (!aboveHorizon || !preview) {
      cancelShadowWait();
      moveLight();
    } else if (shadowWait === null) {
      const wait = shadowAskedAt + PREVIEW_SHADOW_MS - performance.now();
      if (wait <= 0) {
        moveLight();
      } else {
        shadowWait = setTimeout(() => {
          shadowWait = null;
          moveLight();
        }, wait);
      }
    }
    // Quick ramp after sunrise, flat during the day.
    sun.intensity = SUN_INTENSITY * Math.min(1, Math.max(dir.y, 0) * 5);
    const altitudeDeg = altitudeOf(dir.y);
    // Civil-dusk ignition curve: 0 by day, 1 once the sun is well below.
    const nightFactor = nightFactorAt(altitudeDeg);
    // Generous daytime fill, but crushed at night so the warm lamp pools have
    // dark contrast to read against.
    hemisphere.intensity =
      (0.45 + 0.6 * Math.max(dir.y, 0)) * (1 - 0.75 * nightFactor);

    // Sky dome follows the same sun; fog + fill colors follow the palette.
    sky.setSun(dir);
    mirrored.setSun(dir);
    const palette = atmosphereAt(altitudeDeg);
    fogColor.value.set(palette.fog);
    sky.setHaze(palette.fog);
    mirrored.setHaze(palette.fog);
    reflection?.refresh(dir, preview);
    paletteBackground = new Color(palette.fog).getHex();
    if (scene.background instanceof Color && !parallel) {
      scene.background.set(palette.fog);
    }
    hemisphere.color.set(palette.hemiSky);
    hemisphere.groundColor.set(palette.hemiGround);

    return { altitudeDeg, aboveHorizon, nightFactor };
  };

  return {
    update,
    follow,
    followFootprint,
    setParallel,
    invalidateShadow,
    // Below the horizon nothing asks for a redraw; sunrise asks anew.
    shadowPending: () => sun.shadow.needsUpdate,
    shadowBusy: () => sunUp && rings.anyDirty(),
    shadowMapBytes: shadowMapBytesFor(shadowMapSize),
    shadowReach: rings.reach,
    shadowCamera: square,
    shadowMap: {
      depth: rings.depth,
      rings: rings.nodes,
    },
    dispose: () => {
      cancelShadowWait();
      reflection?.dispose();
      mirrored.mesh.geometry.dispose();
      mirrored.mesh.material.dispose();
      sun.dispose();
      rings.dispose();
    },
  };
}
