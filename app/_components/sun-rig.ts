import type { Box3, Camera, Scene } from "three";
import { Color, DirectionalLight, Fog, HemisphereLight, Vector3 } from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { atmosphereAt } from "@/lib/city/atmosphere";
import {
  fitShadowRadius,
  SHADOW_BASE_RADIUS,
  shadowDeadZone,
  shadowFocusAhead,
} from "@/lib/city/shadow-fit";
import { sunDirectionWorld } from "@/lib/city/sun";

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
  /** Frees the shadow map — a render target disposeObject3D never reaches. */
  dispose: () => void;
  /**
   * Re-fits the shadow frustum to the camera (call per frame). `direction` is
   * the camera's world direction (NOT normalized in the horizontal plane — its
   * cos(pitch) factor is what aims the frustum) and `groundY` the terrain
   * elevation under the camera, which is both the frustum's vertical anchor
   * and the altitude the half-size is derived from (lib/city/shadow-fit.ts).
   */
  follow: (position: Vector3, direction: Vector3, groundY: number) => void;
  /** Forces a one-off shadow-map re-render. The map is otherwise only redrawn
   * when the sun or frustum moves (autoUpdate is off), so scene-topology edits
   * (demolish / insert) must call this or stale shadows linger. */
  invalidateShadow: () => void;
  /** Advances the sky dome's drifting clouds (call per frame with elapsed s). */
  setTime: (seconds: number) => void;
  /** The sun's shadow camera: the tile stream loads what it sees too, so a
   *  building behind the player still casts into the view. */
  shadowCamera: Camera;
  /** GPU bytes of the shadow map (RGBA8 depth-packed, no mipmaps). */
  shadowMapBytes: number;
  /** True when the next render will redraw the shadow map. */
  shadowPending: () => boolean;
  /** Re-aims sun, sky dome, fog and fill light for the given instant. */
  update: (date: Date) => SunState;
}

const SUN_INTENSITY = 2.4;

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
  /** Shadow-map edge in texels (scene-profile.ts `shadowMapSizeFor`). 3072
   * over the 110 m base frustum ≈ 0.07 m/texel: the soft Vogel-disk PCF (see
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
  sunDirectionOut?: Vector3
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

  const sun = new DirectionalLight(0xff_f4_e0, SUN_INTENSITY);
  sun.castShadow = true;
  // Re-render the shadow map only when the frustum actually moves or the sun
  // changes (see reposition/update) — not every frame. Huge win with tens of
  // thousands of shadow-casting trees.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const cam = sun.shadow.camera;
  /**
   * Rebuilds the orthographic shadow camera for a new half-size. Everything
   * that scales with the radius lives here, so the rest of the rig only ever
   * reads the four `let`s above. Cheap — a projection matrix, no reallocation:
   * the shadow map itself keeps its size, only the world area it covers
   * changes. The caller forces the re-render (the frustum always moved too).
   */
  const resizeFrustum = (next: number) => {
    radius = next;
    shadowDistance = radius * 2;
    texelSize = (radius * 2) / shadowMapSize;
    deadZone = shadowDeadZone(radius);
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    // Tight depth range around the frustum for good precision.
    cam.near = shadowDistance - radius * 1.2;
    cam.far = shadowDistance + radius * 1.2;
    cam.updateProjectionMatrix();
  };
  resizeFrustum(radius);
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

  const follow = (position: Vector3, direction: Vector3, groundY: number) => {
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
      sun.shadow.needsUpdate = true;
    }
    focus.set(wantX, groundY, wantZ);
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
    shadowMapBytes: shadowMapSize * shadowMapSize * 4,
    shadowCamera: sun.shadow.camera,
    dispose: () => sun.dispose(),
  };
}
