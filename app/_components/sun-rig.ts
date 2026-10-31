import {
  type Box3,
  type Camera,
  Color,
  type DepthTexture,
  DirectionalLight,
  HemisphereLight,
  type Light,
  type LightShadow,
  type Matrix4,
  type Node,
  type NodeBuilder,
  OrthographicCamera,
  type PerspectiveCamera,
  RenderTarget,
  Scene,
  ShadowNode,
  Vector3,
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
import type { UniformNode, WebGPURenderer } from "three/webgpu";
import { atmosphereAt } from "@/lib/city/atmosphere";
import { fitModelShadow } from "@/lib/city/model-view";
import {
  fitShadowRadius,
  SHADOW_BASE_RADIUS,
  shadowDeadZone,
  shadowFocusAhead,
} from "@/lib/city/shadow-fit";
import {
  fitWarpedShadow,
  WARP_FROM_M,
  WARP_MAX_REACH_M,
  WARP_REACH_OF_FOG,
  WARP_UNTIL_M,
  type WarpFit,
  type WarpView,
  warpCovers,
} from "./shadow-warp";
import { sunDirectionWorld } from "@/lib/city/sun";
import { shadowMapBytesFor } from "./scene-profile";
import { createSkyReflection } from "./sky-reflection";
import type { Live, V3, V4 } from "./shader-chunks";

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

/**
 * The night factor as the picture styles read it in their graphs — the
 * stylize pass, Papier's and Strich's card: one shared uniform, written
 * with the sun (create-app.ts `relight`, from the rig's `nightFactor`).
 */
export const styleNight: Live = uniform(0);

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
   * Re-fits the shadow frustum to the camera (call per frame). `direction` is
   * the camera's world direction (NOT normalized in the horizontal plane — its
   * cos(pitch) factor is what aims the frustum) and `groundY` the terrain
   * elevation under the camera, which is both the frustum's vertical anchor
   * and the altitude the half-size is derived from (lib/city/shadow-fit.ts).
   * From the air the map is warped over the view instead, out to a share
   * of the fog (shadow-warp.ts; `air`); the square still follows,
   * for the tiles the sun's camera streams.
   */
  follow: (
    camera: PerspectiveCamera,
    direction: Vector3,
    groundY: number,
    air: AirView
  ) => void;
  /**
   * Re-fits the shadow frustum to the ground a parallel view shows (Modell,
   * plan 055): centred on the footprint's circle at its ground height, its
   * half-size in half-octave steps up to `max` (lib/city/model-view.ts).
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
  /** Forces a one-off shadow-map re-render. The map is otherwise only redrawn
   * when the sun or frustum moves (autoUpdate is off), so scene-topology edits
   * (demolish, a tile landing or leaving) must call this or stale shadows linger. */
  invalidateShadow: () => void;
  /** The square around the view's ground the sun's camera streams for: the
   *  tile stream loads what it sees too, so a building behind the player
   *  still casts into the view. On foot and in Modell it is the shadow
   *  camera's own frustum; from the air the map is warped over the view
   *  (shadow-warp.ts), and the stream keeps the square. */
  shadowCamera: Camera;
  /** GPU bytes of the shadow map: a 32-bit depth texture, no colour
   *  target, no mipmaps (scene-profile.ts `shadowMapBytesFor`). */
  shadowMapBytes: number;
  /** The shadow frustum on the ground, kept current: its centre in the data
   *  frame (x east, y north: world x, −z) and its half-size (z, m) — from
   *  the air the eye's ground and how far the warped map reaches. The
   *  terrain reads it by reference (the horizon's near band, sky-light.ts). */
  shadowReach: Vector3;
  /** True when the next render will redraw the shadow map. */
  shadowPending: () => boolean;
  /**
   * The sun's shadow map as a post pass may read it: its depth (null until
   * the first lit material made it) and the world → map matrix three keeps
   * current (`LightShadow.matrix`). The picture styles test a pixel's
   * world point against it (stylize-effect.ts): in the sun or not.
   */
  shadowMap: {
    bias: () => number;
    depth: () => DepthTexture | null;
    matrix: Matrix4;
  };
  /** Re-aims sun, sky dome, fog and fill light for the given instant. */
  update: (date: Date, preview?: boolean) => SunState;
}

const SUN_INTENSITY = 2.4;

/** Receivers lie this far under the site's low ground (m: a river bed, a
 *  cutting) … */
const RECEIVER_DIP_M = 20;
/** … and this far over its high ground (m: the hills above it, and the
 *  roofs on them — the band is the site's 90th height percentile, and a
 *  slope above the band would be neither on the map nor, within its
 *  reach, under the horizon's near band). */
const RECEIVER_RISE_M = 250;

/** What the warped map needs to know of the view beyond the camera. */
export interface AirView {
  /** where the fog ends (m) */
  fogEnd: number;
  /** the site's high ground (m, world y: its 90th height percentile) */
  groundHigh: number;
  /** the site's low ground (m, world y: its 2nd height percentile) */
  groundLow: number;
}

/** The walker's depth bias (depth units of the square frustum). */
const SQUARE_BIAS = -0.0003;

/**
 * The PCF spread in texels (three's `shadow.radius`). The walker's square
 * has fine, even texels and a wide spread hides their staircase; the warped
 * map's texels near the camera are already as coarse as that spread was
 * wide, so its spread is narrower and the edges stay about as soft.
 */
const SQUARE_PCF_RADIUS = 5;
const WARP_PCF_RADIUS = 3;

/**
 * The sun's shadow camera: three's orthographic one, with an optional warp
 * after its box (shadow-warp.ts). `updateProjectionMatrix` — which
 * three calls when the backend's coordinate system or depth direction is
 * set — rebuilds the box for them and applies the warp again, so the
 * projection is never left without it. Without a warp it is three's camera.
 */
class WarpedShadowCamera extends OrthographicCamera {
  /** light view → warped coordinates (shadow-warp.ts `WarpFit.warp`) */
  warp: Matrix4 | null = null;
  override updateProjectionMatrix(): void {
    super.updateProjectionMatrix();
    if (this.warp) {
      this.projectionMatrix.multiply(this.warp);
      this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    }
  }
}

/**
 * Least time (ms) between two shadow-map redraws while the time of day is
 * dragged: the map is the heaviest pass (every caster), and a drag turns
 * the sun at every frame. Ten a second keep the shadows moving with it; the
 * drag's end redraws at once.
 */
const PREVIEW_SHADOW_MS = 100;

/** What three's ShadowNode makes the map in: its documented override. */
interface ShadowTargets {
  depthTexture: DepthTexture;
  shadowMap: RenderTarget;
}
// reason: setupRenderTarget is part of ShadowNode (ShadowNode.js documents
// overriding it, TileShadowNode does) but missing from the @types.
const ShadowNodeWithTarget = ShadowNode as unknown as new (
  light: Light,
  shadow: LightShadow | null
) => ShadowNode & {
  setupRenderTarget(shadow: LightShadow, builder: NodeBuilder): ShadowTargets;
};

/**
 * three's shadow node, its map the depth alone. three's own map is a render
 * target with a colour texture of the shadow's `mapType` (RGBA, four bytes)
 * beside the depth the PCF filter reads — as large again as the depth (16
 * MB at a phone's 2048²) for a colour only coloured shadows sample
 * (`renderer.shadowMap.transmitted`, never on here). Since r187 a render
 * target may have no colour attachment (`count: 0`, both backends), as
 * three's tiled shadows draw theirs: this one keeps three's depth texture
 * and drops the colour. Installed as the light's `shadow.shadowNode` — what
 * three's own CSM and tiled shadows plug in through — so nothing of three
 * is patched (ADR 0027).
 */
class DepthOnlyShadowNode extends ShadowNodeWithTarget {
  /** the map's depth, once the first lit material made it */
  depth: DepthTexture | null = null;
  setupRenderTarget(shadow: LightShadow, builder: NodeBuilder): ShadowTargets {
    // three's depth texture (its name, its compare function), in a target
    // of its own without the colour — the one made with it is never
    // allocated, and goes
    const made = super.setupRenderTarget(shadow, builder);
    const { depthTexture } = made;
    // handed over: the depth belongs to the target that draws it, which
    // frees it with itself (a texture keeps the first target it was given)
    made.shadowMap.depthTexture = null;
    const shadowMap = new RenderTarget(
      shadow.mapSize.width,
      shadow.mapSize.height,
      { count: 0 }
    );
    shadowMap.depthTexture = depthTexture;
    this.depth = depthTexture;
    return { shadowMap, depthTexture };
  }
}

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
    setSun: (d) => sky.sunPosition.value.copy(d),
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
  /** Shadow-map edge in texels (scene-profile.ts `shadowMapSizeFor`). 3072
   * over the 121 m base frustum ≈ 0.08 m/texel: the soft Vogel-disk PCF (see
   * shadow.radius) hides residual stepping, so 3072 looks like 4096 here
   * while costing ~44% less shadow fill. The `lite` e2e profile passes 512
   * and phones 2048 — under SwiftShader the depth pass is one of the few
   * per-frame costs that does not shrink with the canvas, and no headless
   * assertion depends on edge quality. The map is redrawn when the frustum
   * re-centres or re-fits (follow), when the sun moves, and on explicit
   * invalidation — not per frame. */
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
  // The frustum half-size is not fixed: it starts at the base radius (eye
  // level) and grows with altitude so a fly-over still gets sun shadows —
  // lib/city/shadow-fit.ts owns the policy, resizeFrustum below applies it.
  // These three derive from it and are recomputed on every change.
  let radius = SHADOW_BASE_RADIUS;
  // Light sits twice the frustum radius out; tight depth range = good precision.
  let shadowDistance = radius * 2;
  // World size of one shadow texel — snap the frustum centre to this grid so
  // shadow edges don't crawl/shimmer as the camera moves.
  let texelSize = (radius * 2) / shadowMapSize;
  // Metres the frustum centre may drift before the map is re-rendered.
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
  // Re-render the shadow map only when the frustum actually moves or the sun
  // changes (see reposition/update) — not every frame. Huge win with tens of
  // thousands of shadow-casting trees.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  // The sun stays in the scene by night, at intensity 0: three keys every
  // material's build by the lights it draws with, so a light that left the
  // scene at dusk rebuilt every material in view, inside the frame, at every
  // dusk and dawn. Below the horizon the map is simply never asked for.
  let sunUp = true;
  const redrawShadow = () => {
    if (sunUp) {
      sun.shadow.needsUpdate = true;
    }
  };
  let shadowAskedAt = Number.NEGATIVE_INFINITY;
  let shadowWait: ReturnType<typeof setTimeout> | null = null;
  const cancelShadowWait = () => {
    if (shadowWait !== null) {
      clearTimeout(shadowWait);
      shadowWait = null;
    }
  };
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  // The map's camera: three's orthographic one, warped over the view from
  // the air (`WarpedShadowCamera`), set before the shadow node reads it.
  const cam = new WarpedShadowCamera();
  sun.shadow.camera = cam;
  // The square around the view's ground (shadow-fit.ts): on foot and in
  // Modell the map's own frustum, always the one the sun's camera streams
  // for (`shadowCamera`) — from the air too, where the map is warped and
  // the stream keeps loading what it loaded.
  const square = new OrthographicCamera();
  /**
   * Rebuilds the square for a new half-size. Everything that scales with
   * the radius lives here, so the rest of the rig only ever reads the four
   * `let`s above. Cheap — a projection matrix, no reallocation: the shadow
   * map itself keeps its size, only the world area it covers changes. The
   * caller forces the re-render (the frustum always moved too).
   */
  const resizeFrustum = (next: number) => {
    radius = next;
    shadowDistance = radius * 2;
    texelSize = (radius * 2) / shadowMapSize;
    deadZone = shadowDeadZone(radius);
    square.left = -radius;
    square.right = radius;
    square.top = radius;
    square.bottom = -radius;
    // Tight depth range around the frustum for good precision.
    square.near = shadowDistance - radius * 1.2;
    square.far = shadowDistance + radius * 1.2;
    square.updateProjectionMatrix();
  };
  /** The map's ortho box (with the warp, if any, applied after it). */
  const setBox = (box: WarpFit["box"]) => {
    cam.left = box.left;
    cam.right = box.right;
    cam.top = box.top;
    cam.bottom = box.bottom;
    cam.near = box.near;
    cam.far = box.far;
    cam.updateProjectionMatrix();
  };
  /** The map's frustum is the square's (on foot, in Modell). */
  const squareToMap = () => setBox(square);
  resizeFrustum(radius);
  squareToMap();
  // normalBias = 0 kills the peter-panning contact strip (it would offset the
  // flat ground's shadow sample toward the light at wall bases). Safe at 0
  // because nothing that needs it self-shadows: terrain doesn't cast, and
  // buildings/trees cast via their BACK faces (three's default shadowSide), so
  // their lit front faces never self-acne.
  sun.shadow.bias = SQUARE_BIAS;
  sun.shadow.normalBias = 0;
  // PCFShadowMap is soft: three's ShadowFilterNode (PCFShadowFilter) spreads
  // a 5-tap Vogel disk by radius*texel. Default radius 1 ≈ hard; bump it so
  // edges are a soft penumbra that hides the texel staircase — without VSM's
  // grid.
  sun.shadow.radius = SQUARE_PCF_RADIUS;
  const shadowNode = new DepthOnlyShadowNode(sun, sun.shadow);
  // reason: `shadowNode` is read by three's AnalyticLightNode but missing
  // from LightShadow's @types.
  (sun.shadow as LightShadow & { shadowNode?: Node }).shadowNode = shadowNode;
  scene.add(sun, sun.target);

  // Current sun direction and frustum focus; reposition() places the light and
  // its target from these so update() (time) and follow() (camera) share logic.
  const dir = new Vector3();
  {
    const d = sunDirectionWorld(new Date(0), latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    sunDirectionOut?.copy(dir);
  }
  const focus = center.clone();
  const shadowReach = new Vector3(center.x, -center.z, radius);
  const lastCentre = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  // From the air: the warp the map holds (null: the map is the square) and
  // the view it was last fitted for, which a turn of the sun fits anew.
  let airborne = false;
  let warpFit: WarpFit | null = null;
  let warpView: WarpView | null = null;

  /** The light, its target and the map's matrices after a move. The shadow
   *  camera is also a streaming camera (create-app.ts): three updates it
   *  only while drawing the shadow, which by night it never does — a stale
   *  frustum would keep its tiles loaded. */
  const placeLight = () => {
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
  };

  /** The map takes `fit`'s warp; `redraw` false while the sun is dragged
   *  (update() paces those redraws itself). */
  const applyWarp = (fit: WarpFit, redraw: boolean) => {
    warpFit = fit;
    cam.up.copy(fit.up);
    cam.warp = fit.warp;
    setBox(fit.box);
    sun.shadow.bias = fit.bias;
    sun.shadow.radius = WARP_PCF_RADIUS;
    sun.target.position.copy(fit.target);
    sun.position.copy(fit.target).add(dir);
    shadowReach.set(fit.target.x, -fit.target.z, fit.reachPlan);
    placeLight();
    if (redraw) {
      redrawShadow();
    }
  };

  /** The map is the square again (on the ground, in Modell). */
  const dropWarp = () => {
    warpFit = null;
    warpView = null;
    cam.warp = null;
    cam.up.set(0, 1, 0);
    sun.shadow.bias = SQUARE_BIAS;
    sun.shadow.radius = SQUARE_PCF_RADIUS;
    // reposition() places the light anew and redraws
    lastCentre.set(Number.NaN, Number.NaN, Number.NaN);
  };

  const reposition = () => {
    // Snap the focus to the texel grid to keep shadow edges stable.
    const fx = Math.round(focus.x / texelSize) * texelSize;
    const fy = Math.round(focus.y / texelSize) * texelSize;
    const fz = Math.round(focus.z / texelSize) * texelSize;
    square.position.set(
      fx + dir.x * shadowDistance,
      fy + dir.y * shadowDistance,
      fz + dir.z * shadowDistance
    );
    square.lookAt(fx, fy, fz);
    square.updateMatrixWorld();
    if (warpFit) {
      // the map stands where the warp put it; only the stream follows
      lastCentre.set(fx, fy, fz);
      return;
    }
    squareToMap();
    sun.target.position.set(fx, fy, fz);
    sun.position.copy(square.position);
    shadowReach.set(fx, -fz, radius);
    // Manual shadow update only when the snapped frustum centre changed.
    // fy matters too: ascending straight up in fly mode keeps fx/fz fixed
    // while the frustum's vertical slice shifts.
    if (fx !== lastCentre.x || fy !== lastCentre.y || fz !== lastCentre.z) {
      redrawShadow();
      lastCentre.set(fx, fy, fz);
    }
    placeLight();
  };

  /** Re-fits the square (the stream's, and on foot the map's). */
  const followSquare = (
    position: Vector3,
    direction: Vector3,
    groundY: number
  ) => {
    const nextRadius = fitShadowRadius(position.y - groundY, radius);
    // Push the centre along the view so the shadowed patch sits where the
    // camera is looking. `direction` is deliberately NOT re-normalized in the
    // horizontal plane: its cos(pitch) factor collapses the offset to zero
    // when looking straight down, which is exactly what we want there.
    const ahead = shadowFocusAhead(nextRadius);
    const wantX = position.x + direction.x * ahead;
    const wantZ = position.z + direction.z * ahead;
    // Inside the dead zone, at an unchanged radius, the frustum stays put —
    // nothing to re-render. The centre is anchored to the GROUND, not the
    // camera: airborne, a frustum centred on the camera puts its tight depth
    // range hundreds of metres above the terrain that should be shadowed.
    if (
      nextRadius === radius &&
      Number.isFinite(lastCentre.x) &&
      Math.hypot(
        wantX - lastCentre.x,
        groundY - lastCentre.y,
        wantZ - lastCentre.z
      ) < deadZone
    ) {
      return;
    }
    if (nextRadius !== radius) {
      resizeFrustum(nextRadius);
      // A resized frustum covers different world even from the same centre,
      // and the texel grid it snaps to has changed — always redraw.
      if (!warpFit) {
        redrawShadow();
      }
    }
    focus.set(wantX, groundY, wantZ);
    reposition();
  };

  const follow = (
    camera: PerspectiveCamera,
    direction: Vector3,
    groundY: number,
    air: AirView
  ) => {
    const position = camera.position;
    const height = position.y - groundY;
    // hysteresis: a switch is a depth pass
    if (airborne ? height < WARP_UNTIL_M : height > WARP_FROM_M) {
      airborne = !airborne;
      if (!airborne && warpFit) {
        dropWarp();
      }
    }
    followSquare(position, direction, groundY);
    if (!airborne) {
      return;
    }
    const reach = Math.min(air.fogEnd * WARP_REACH_OF_FOG, WARP_MAX_REACH_M);
    const fov = camera.getEffectiveFOV();
    // a camera standing still (most frames) asks nothing new of the map
    if (
      warpFit &&
      warpView &&
      warpView.eye.equals(position) &&
      warpView.forward.distanceToSquared(direction) < 1e-12 &&
      warpView.groundY === groundY &&
      warpView.reach === reach &&
      warpView.fovDeg === fov &&
      warpView.aspect === camera.aspect
    ) {
      return;
    }
    // the view as it is now: a turn of the sun fits the map to it (update)
    warpView = {
      aspect: camera.aspect,
      ceilingY: Math.max(groundY, air.groundHigh) + RECEIVER_RISE_M,
      eye: position.clone(),
      floorY: Math.min(groundY, air.groundLow) - RECEIVER_DIP_M,
      forward: direction.clone().normalize(),
      fovDeg: fov,
      groundY,
      reach,
      up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize(),
    };
    if (warpFit && warpCovers(warpFit, warpView)) {
      return;
    }
    // looking at the sky (no receiver in view) keeps what the map holds
    const fit = fitWarpedShadow(warpView, dir);
    if (fit) {
      applyWarp(fit, true);
    }
  };

  const followFootprint = (
    x: number,
    groundY: number,
    z: number,
    footRadius: number,
    max: number
  ) => {
    airborne = false;
    if (warpFit) {
      dropWarp();
    }
    const nextRadius = fitModelShadow(footRadius, radius, max);
    if (
      nextRadius === radius &&
      Number.isFinite(lastCentre.x) &&
      Math.hypot(x - lastCentre.x, groundY - lastCentre.y, z - lastCentre.z) <
        deadZone
    ) {
      return;
    }
    if (nextRadius !== radius) {
      resizeFrustum(nextRadius);
      redrawShadow();
    }
    focus.set(x, groundY, z);
    reposition();
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

  const update = (date: Date, preview = false): SunState => {
    const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    sunDirectionOut?.copy(dir);
    const aboveHorizon = dir.y > 0;
    sunUp = aboveHorizon;
    reposition();
    // the warp is fitted to the sun as well as to the view
    if (warpView) {
      const fit = fitWarpedShadow(warpView, dir);
      if (fit) {
        applyWarp(fit, false);
      }
    }
    // The sun moved: redraw by day (a drag's step at most every
    // PREVIEW_SHADOW_MS, the last after the wait); by night drop a request
    // still open.
    if (!aboveHorizon || !preview) {
      cancelShadowWait();
      sun.shadow.needsUpdate = aboveHorizon;
      shadowAskedAt = performance.now();
    } else if (shadowWait === null) {
      const wait = shadowAskedAt + PREVIEW_SHADOW_MS - performance.now();
      if (wait <= 0) {
        sun.shadow.needsUpdate = true;
        shadowAskedAt = performance.now();
      } else {
        shadowWait = setTimeout(() => {
          shadowWait = null;
          shadowAskedAt = performance.now();
          redrawShadow();
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

  const invalidateShadow = redrawShadow;

  return {
    update,
    follow,
    followFootprint,
    setParallel,
    invalidateShadow,
    // Below the horizon nothing asks for a redraw; sunrise asks anew.
    shadowPending: () => sun.shadow.needsUpdate,
    shadowMapBytes: shadowMapBytesFor(shadowMapSize),
    shadowReach,
    shadowCamera: square,
    shadowMap: {
      bias: () => sun.shadow.bias,
      depth: () => shadowNode.depth,
      matrix: sun.shadow.matrix,
    },
    dispose: () => {
      cancelShadowWait();
      reflection?.dispose();
      mirrored.mesh.geometry.dispose();
      mirrored.mesh.material.dispose();
      sun.dispose();
      shadowNode.dispose();
    },
  };
}
