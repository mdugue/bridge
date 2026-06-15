import type { Box3, Scene } from "three";
import { Color, DirectionalLight, Fog, HemisphereLight, Vector3 } from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { atmosphereAt } from "@/lib/city/atmosphere";
import { sunDirectionWorld } from "@/lib/city/sun";
import { clamp } from "@/lib/math";

export interface SunState {
  aboveHorizon: boolean;
  altitudeDeg: number;
}

export interface SunRig {
  /** Re-centers the shadow frustum on a focus point (call per frame with the
   * camera position) so the player always stands in the high-res shadow area. */
  follow: (focus: Vector3) => void;
  /** Re-aims sun, sky dome, fog and fill light for the given instant. */
  update: (date: Date) => SunState;
}

const SUN_INTENSITY = 2.4;
/** 3072 over the 110 m frustum ≈ 0.07 m/texel. The soft Vogel-disk PCF (see
 * shadow.radius) hides residual stepping, so 3072 looks like 4096 here while
 * costing ~44% less shadow fill — it re-renders on most frames while walking. */
const SHADOW_MAP_SIZE = 3072;
/** Half-size of the shadow frustum, in metres. Small = fine texels (smoother
 * shadow edges, less staircase under PCFSoft); the frustum follows the camera
 * so street-level coverage isn't lost. 160 m → ~0.16 m texels at 2048². */
const SHADOW_RADIUS = 110;

function createSkyDome(scene: Scene): Sky {
  const sky = new Sky();
  // Inside the camera far plane (6000) but beyond the fog end.
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.75;
  scene.add(sky);
  return sky;
}

/**
 * Sun + atmosphere rig: directional light with an orthographic shadow camera
 * sized to the whole scene, a physical sky dome fed the same sun direction,
 * and fog/hemisphere colors interpolated from the time-of-day palette so the
 * whole frame stays in tune with the slider. `worldBounds` is in scene
 * (Y-up) coordinates.
 */
export function createSunRig(
  scene: Scene,
  worldBounds: Box3,
  latLng: { lat: number; lng: number }
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
  // their lit front faces never self-acne. VSM softens edges via a SMALL blur.
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
  }
  const focus = center.clone();
  let lastFx = Number.NaN;
  let lastFy = Number.NaN;
  let lastFz = Number.NaN;
  // `force` re-places the light even when the focus cell is unchanged — needed
  // by update() when the sun direction moved but the camera (focus) did not.
  const reposition = (force = false) => {
    // Snap the focus to the texel grid to keep shadow edges stable while moving.
    const fx = Math.round(focus.x / texelSize) * texelSize;
    const fy = Math.round(focus.y / texelSize) * texelSize;
    const fz = Math.round(focus.z / texelSize) * texelSize;
    // While the camera sits within the same texel cell the light, its target
    // and the shadow map are all unchanged — skip the per-frame matrix writes.
    if (!force && fx === lastFx && fy === lastFy && fz === lastFz) {
      return;
    }
    sun.target.position.set(fx, fy, fz);
    sun.position.set(
      fx + dir.x * shadowDistance,
      fy + dir.y * shadowDistance,
      fz + dir.z * shadowDistance
    );
    // Manual shadow update only when the snapped frustum centre moved in X/Z.
    if (fx !== lastFx || fz !== lastFz) {
      sun.shadow.needsUpdate = true;
    }
    lastFx = fx;
    lastFy = fy;
    lastFz = fz;
  };

  const follow = (point: Vector3) => {
    focus.copy(point);
    reposition();
  };

  const update = (date: Date): SunState => {
    const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    const aboveHorizon = dir.y > 0;
    reposition(true);
    sun.shadow.needsUpdate = true; // sun moved — force a shadow re-render
    sun.visible = aboveHorizon;
    // Quick ramp after sunrise, flat during the day.
    sun.intensity = SUN_INTENSITY * Math.min(1, Math.max(dir.y, 0) * 5);
    // Generous fill so shadowed facades stay readable at street level.
    hemisphere.intensity = 0.45 + 0.6 * Math.max(dir.y, 0);

    // Sky dome follows the same sun; fog + fill colors follow the palette.
    (sky.material.uniforms.sunPosition.value as Vector3).set(
      dir.x,
      dir.y,
      dir.z
    );
    const altitudeDeg = (Math.asin(clamp(dir.y, -1, 1)) * 180) / Math.PI;
    const palette = atmosphereAt(altitudeDeg);
    if (scene.fog instanceof Fog) {
      scene.fog.color.set(palette.fog);
    }
    if (scene.background instanceof Color) {
      scene.background.set(palette.fog);
    }
    hemisphere.color.set(palette.hemiSky);
    hemisphere.groundColor.set(palette.hemiGround);

    return { altitudeDeg, aboveHorizon };
  };

  return { update, follow };
}
