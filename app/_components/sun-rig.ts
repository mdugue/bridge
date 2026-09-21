import type { Box3, Scene } from "three";
import { Color, DirectionalLight, Fog, HemisphereLight, Vector3 } from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { atmosphereAt } from "@/lib/city/atmosphere";
import { sunDirectionWorld } from "@/lib/city/sun";
import {
  currentDeviceTier,
  currentSceneProfile,
  shadowMapSizeFor,
} from "./scene-profile";

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

export interface SunRig {
  /** Re-centers the shadow frustum on a focus point (call per frame with the
   * camera position) so the player always stands in the high-res shadow area. */
  follow: (focus: Vector3) => void;
  /** Forces a one-off shadow-map re-render. The map is otherwise only redrawn
   * when the sun or frustum moves (autoUpdate is off), so scene-topology edits
   * (demolish / insert) must call this or stale shadows linger. */
  invalidateShadow: () => void;
  /** Advances the sky dome's drifting clouds (call per frame with elapsed s). */
  setTime: (seconds: number) => void;
  /** GPU bytes of the shadow map (RGBA8 depth-packed, no mipmaps). */
  shadowMapBytes: number;
  /** True when the next render will redraw the shadow map. */
  shadowPending: () => boolean;
  /** Re-aims sun, sky dome, fog and fill light for the given instant. */
  update: (date: Date) => SunState;
}

const SUN_INTENSITY = 2.4;
/** 3072 over the 110 m frustum ≈ 0.07 m/texel. The soft Vogel-disk PCF (see
 * shadow.radius) hides residual stepping, so 3072 looks like 4096 here while
 * costing ~44% less shadow fill. The map is redrawn at each FOLLOW_DEAD_ZONE_M
 * re-centre, when the sun moves, and on explicit invalidation — not per frame.
 * The `lite` e2e profile drops this to 512 and phones get 2048 (see
 * scene-profile.ts): under SwiftShader the depth pass is one of the few
 * per-frame costs that does not shrink with the canvas, and no headless
 * assertion depends on edge quality. */
const SHADOW_MAP_SIZE = shadowMapSizeFor(
  currentSceneProfile(),
  currentDeviceTier()
);
/** Half-size of the shadow frustum, in metres. Small = fine texels (smoother
 * shadow edges, less staircase under PCFSoft); the frustum follows the camera
 * so street-level coverage isn't lost. 110 m → ~0.07 m texels at 3072². */
const SHADOW_RADIUS = 110;
/**
 * Metres the player may drift from the last re-centred frustum before the
 * shadow map is re-rendered. Re-centring on every texel (0.07 m) meant the
 * ~640k-triangle depth pass ran on every moving frame; 20 m keeps the
 * player well inside the 110 m half-size (90 m of margin in every
 * direction) and turns ~60 re-renders/s while walking into ~0.5/s. The
 * texel snap below still applies at each re-centre, so edges do not crawl.
 */
const FOLLOW_DEAD_ZONE_M = 20;

function createSkyDome(scene: Scene): Sky {
  const sky = new Sky();
  // Inside the camera far plane (6000) but beyond the fog end.
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.75;
  // Sky.js (r184) already ships a procedural drifting-cloud system (multi-octave
  // fbm, sun-tinted) but nothing advances its `time`, so the clouds were frozen.
  // Soften the defaults toward pale watercolor washes (not cotton balls) and let
  // the render loop drive `time` for a gentle Dresden breeze. Effectively free:
  // the fbm only runs on sky pixels (direction.y > 0).
  u.cloudCoverage.value = 0.3;
  u.cloudDensity.value = 0.3;
  // Slow drift — a barely-moving Dresden sky, not racing clouds.
  u.cloudSpeed.value = 0.0001;
  scene.add(sky);
  return sky;
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
  /** Optional shared vector the rig keeps in sync with the world sun direction
   * (surface→sun) so other materials (e.g. the crown shimmer) can read it. */
  sunDirectionOut?: Vector3
): SunRig {
  const center = worldBounds.getCenter(new Vector3());
  // Light sits twice the frustum radius out; tight depth range = good precision.
  const shadowDistance = SHADOW_RADIUS * 2;
  // World size of one shadow texel — snap the frustum centre to this grid so
  // shadow edges don't crawl/shimmer as the camera moves.
  const texelSize = (SHADOW_RADIUS * 2) / SHADOW_MAP_SIZE;

  const hemisphere = new HemisphereLight(0xbf_d4_e6, 0x4a_5a_3a, 0.7);
  scene.add(hemisphere);

  const sky = createSkyDome(scene);

  const sun = new DirectionalLight(0xff_f4_e0, SUN_INTENSITY);
  sun.castShadow = true;
  // Re-render the shadow map only when the frustum actually moves or the sun
  // changes (see reposition/update) — not every frame. Huge win with tens of
  // thousands of shadow-casting trees.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_RADIUS;
  cam.right = SHADOW_RADIUS;
  cam.top = SHADOW_RADIUS;
  cam.bottom = -SHADOW_RADIUS;
  // Tight depth range around the frustum for good precision.
  cam.near = shadowDistance - SHADOW_RADIUS * 1.2;
  cam.far = shadowDistance + SHADOW_RADIUS * 1.2;
  // normalBias = 0 kills the peter-panning contact strip (it would offset the
  // flat ground's shadow sample toward the light at wall bases). Safe at 0
  // because nothing that needs it self-shadows: terrain doesn't cast, and
  // buildings/trees cast via their BACK faces (three's default shadowSide), so
  // their lit front faces never self-acne.
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0;
  // r182+ PCFShadowMap is soft: it spreads a 5-tap Vogel disk by radius*texel
  // (shadowmap_pars_fragment.glsl). Default radius 1 ≈ hard; bump it so edges
  // are a soft penumbra that hides the texel staircase — without VSM's grid.
  sun.shadow.radius = 5;
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
  const lastCentre = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  const reposition = () => {
    // Snap the focus to the texel grid to keep shadow edges stable.
    const fx = Math.round(focus.x / texelSize) * texelSize;
    const fy = Math.round(focus.y / texelSize) * texelSize;
    const fz = Math.round(focus.z / texelSize) * texelSize;
    sun.target.position.set(fx, fy, fz);
    sun.position.set(
      fx + dir.x * shadowDistance,
      fy + dir.y * shadowDistance,
      fz + dir.z * shadowDistance
    );
    // Manual shadow update only when the snapped frustum centre changed.
    // fy matters too: ascending straight up in fly mode keeps fx/fz fixed
    // while the frustum's vertical slice shifts.
    if (fx !== lastCentre.x || fy !== lastCentre.y || fz !== lastCentre.z) {
      sun.shadow.needsUpdate = true;
      lastCentre.set(fx, fy, fz);
    }
  };

  const follow = (point: Vector3) => {
    // Inside the dead zone the frustum stays put — nothing to re-render.
    if (
      Number.isFinite(lastCentre.x) &&
      point.distanceTo(lastCentre) < FOLLOW_DEAD_ZONE_M
    ) {
      return;
    }
    focus.copy(point);
    reposition();
  };

  const update = (date: Date): SunState => {
    const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    sunDirectionOut?.copy(dir);
    const aboveHorizon = dir.y > 0;
    reposition();
    sun.shadow.needsUpdate = true; // sun moved — force a shadow re-render
    sun.visible = aboveHorizon;
    // Quick ramp after sunrise, flat during the day.
    sun.intensity = SUN_INTENSITY * Math.min(1, Math.max(dir.y, 0) * 5);
    const altitudeDeg =
      (Math.asin(Math.min(Math.max(dir.y, -1), 1)) * 180) / Math.PI;
    // Civil-dusk ignition curve: 0 by day, 1 once the sun is well below.
    const nightFactor = smoothstepDown(2, -6, altitudeDeg);
    // Generous daytime fill, but crushed at night so the warm lamp pools have
    // dark contrast to read against.
    hemisphere.intensity =
      (0.45 + 0.6 * Math.max(dir.y, 0)) * (1 - 0.75 * nightFactor);

    // Sky dome follows the same sun; fog + fill colors follow the palette.
    (sky.material.uniforms.sunPosition.value as Vector3).set(
      dir.x,
      dir.y,
      dir.z
    );
    const palette = atmosphereAt(altitudeDeg);
    if (scene.fog instanceof Fog) {
      scene.fog.color.set(palette.fog);
    }
    if (scene.background instanceof Color) {
      scene.background.set(palette.fog);
    }
    hemisphere.color.set(palette.hemiSky);
    hemisphere.groundColor.set(palette.hemiGround);

    return { altitudeDeg, aboveHorizon, nightFactor };
  };

  const setTime = (seconds: number) => {
    sky.material.uniforms.time.value = seconds;
  };

  const invalidateShadow = () => {
    sun.shadow.needsUpdate = true;
  };

  return {
    update,
    follow,
    setTime,
    invalidateShadow,
    // three only draws the map for a VISIBLE light: below the horizon the
    // flag stays raised (and is consumed at sunrise), so it is not "pending".
    shadowPending: () => sun.visible && sun.shadow.needsUpdate,
    shadowMapBytes: SHADOW_MAP_SIZE * SHADOW_MAP_SIZE * 4,
  };
}
