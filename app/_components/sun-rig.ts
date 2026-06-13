import type { Box3, Scene } from "three";
import { Color, DirectionalLight, Fog, HemisphereLight, Vector3 } from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { atmosphereAt } from "@/lib/city/atmosphere";
import { sunDirectionWorld } from "@/lib/city/sun";

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
const SHADOW_MAP_SIZE = 2048;
/** Half-size of the shadow frustum, in metres. Small = sharp texels (no acne
 * triangles); the frustum follows the camera so coverage isn't lost. */
const SHADOW_RADIUS = 280;

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
  // With the small, camera-following frustum the texels are fine enough that a
  // small bias and a sub-metre normalBias clear the terrain-grid acne without
  // the light-leak triangles the old normalBias=2 band-aid produced.
  // Lower normalBias than before: the large 0.3 offset detached contact
  // shadows (light leaked in where a wall/bridge meets the ground). A small
  // negative depth bias plus PCFSoft keeps the grid acne in check.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.12;
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
  let lastFz = Number.NaN;
  const reposition = () => {
    // Snap the focus to the texel grid to keep shadow edges stable while moving.
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
    if (fx !== lastFx || fz !== lastFz) {
      sun.shadow.needsUpdate = true;
      lastFx = fx;
      lastFz = fz;
    }
  };

  const follow = (point: Vector3) => {
    focus.copy(point);
    reposition();
  };

  const update = (date: Date): SunState => {
    const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    const aboveHorizon = dir.y > 0;
    reposition();
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
    const altitudeDeg =
      (Math.asin(Math.min(Math.max(dir.y, -1), 1)) * 180) / Math.PI;
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
