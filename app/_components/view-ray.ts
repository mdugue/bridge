import {
  type Camera,
  type Raycaster,
  Vector2,
  Vector3,
  WebGPUCoordinateSystem,
} from "three/webgpu";

/** How far a pick ray reaches beyond its origin by default (m). */
const PERSPECTIVE_FAR = 6000;
/**
 * World height (m) nothing in a site reaches above: a parallel view's ray
 * starts 20 km off, so it is moved down to here first — the ground march
 * along it then starts where there can be ground.
 */
const SCENE_TOP = 2500;

const near = new Vector3();
const far = new Vector3();

/** A screen point (NDC) of a parallel camera unprojected onto its near
 *  plane (`near`) and its far plane (`far`). */
function unprojectDepths(ndc: { x: number; y: number }, camera: Camera): void {
  const nearZ = camera.coordinateSystem === WebGPUCoordinateSystem ? 0 : -1;
  near.set(ndc.x, ndc.y, nearZ).unproject(camera);
  far.set(ndc.x, ndc.y, 1).unproject(camera);
}

/**
 * The direction a parallel camera looks along (world, unit, into the
 * scene), into `out`: the same for every screen point, and in a
 * Militärperspektive sheared off the camera's forward — which three's
 * camera does not know, so it is unprojected.
 */
export function parallelDirection(camera: Camera, out: Vector3): Vector3 {
  unprojectDepths({ x: 0, y: 0 }, camera);
  return out.subVectors(far, near).normalize();
}

/**
 * Sets `raycaster` to the ray through a screen point (NDC) of any camera:
 * three's own `setFromCamera` for a perspective one (the ray starts at the
 * camera); for Modell's parallel camera — sheared in a Militärperspektive,
 * which `setFromCamera` does not know — the line between the point
 * unprojected onto the near and the far plane, starting on the near plane.
 * Returns how far the ray may reach (the depth range for a parallel view).
 */
export function setPickRay(
  raycaster: Raycaster,
  ndc: { x: number; y: number },
  camera: Camera
): number {
  const c = camera as Camera & {
    isOrthographicCamera?: boolean;
    far?: number;
    near?: number;
  };
  if (!c.isOrthographicCamera) {
    raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
    return PERSPECTIVE_FAR;
  }
  unprojectDepths(ndc, camera);
  const reach = near.distanceTo(far);
  const direction = far.sub(near).normalize();
  // down to the top of the scene (a level ray starts on its cut)
  const skip =
    direction.y < -1e-3 && near.y > SCENE_TOP
      ? (near.y - SCENE_TOP) / -direction.y
      : 0;
  raycaster.ray.origin.copy(near).addScaledVector(direction, skip);
  raycaster.ray.direction.copy(direction);
  raycaster.camera = camera;
  return reach - skip;
}
