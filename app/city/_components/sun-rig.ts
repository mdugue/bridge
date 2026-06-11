import type { Box3, Scene } from "three";
import { DirectionalLight, HemisphereLight, Vector3 } from "three";
import { sunDirectionWorld } from "@/lib/city/sun";

export interface SunState {
  aboveHorizon: boolean;
  altitudeDeg: number;
}

export interface SunRig {
  /** Re-aims sun + shadow camera for the given instant. */
  update: (date: Date) => SunState;
}

const SUN_INTENSITY = 2.4;
const SHADOW_MAP_SIZE = 2048;

/**
 * Directional sun light with an orthographic shadow camera sized to the
 * whole scene. `worldBounds` is in scene (Y-up) coordinates.
 */
export function createSunRig(
  scene: Scene,
  worldBounds: Box3,
  latLng: { lat: number; lng: number }
): SunRig {
  const center = worldBounds.getCenter(new Vector3());
  const radius = worldBounds.getSize(new Vector3()).length() / 2;

  const hemisphere = new HemisphereLight(0xbf_d4_e6, 0x4a_5a_3a, 0.7);
  scene.add(hemisphere);

  const sun = new DirectionalLight(0xff_f4_e0, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = radius * 0.5;
  cam.far = radius * 3.5;
  // Meter-scale scene: normalBias fights acne on the 4 m terrain grid.
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 2;
  sun.target.position.copy(center);
  scene.add(sun, sun.target);

  const update = (date: Date): SunState => {
    const dir = sunDirectionWorld(date, latLng.lat, latLng.lng);
    const aboveHorizon = dir.y > 0;
    // Keep the light on the scene-bounds sphere, twice the radius away.
    sun.position.set(
      center.x + dir.x * radius * 2,
      center.y + dir.y * radius * 2,
      center.z + dir.z * radius * 2
    );
    sun.visible = aboveHorizon;
    // Quick ramp after sunrise, flat during the day.
    sun.intensity = SUN_INTENSITY * Math.min(1, Math.max(dir.y, 0) * 5);
    // Generous fill so shadowed facades stay readable at street level.
    hemisphere.intensity = 0.45 + 0.6 * Math.max(dir.y, 0);
    return {
      altitudeDeg:
        (Math.asin(Math.min(Math.max(dir.y, -1), 1)) * 180) / Math.PI,
      aboveHorizon,
    };
  };

  return { update };
}
