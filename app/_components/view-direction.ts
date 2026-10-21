import { type Camera, type UniformNode, Vector3 } from "three/webgpu";
import {
  cameraPosition,
  cameraViewMatrix,
  mix,
  normalize,
  positionView,
  positionWorld,
  uniform,
  vec4,
} from "three/tsl";
import type { Live, V3 } from "./shader-chunks";
import { parallelDirection } from "./view-ray";

/** 1 while the camera drawing the frame is a parallel one (Modell). */
export const viewParallel: Live = uniform(0);

/** A parallel view's direction (world, unit, into the scene). */
export const viewRay: UniformNode<"vec3", Vector3> = uniform(
  new Vector3(0, 0, -1)
);

/**
 * The direction the eye looks along at a fragment (world, unit, from the
 * eye into the scene) — what a material reads of the view (ADR 0044): from
 * the camera's place in perspective; in Modell's parallel projection one
 * direction for every pixel, sheared off the camera's forward in a
 * Militärperspektive. There the camera stands 20 km straight over the
 * pivot, and the line from its place would look straight down where the
 * picture looks in at 45°: a Fresnel rim would light every wall facing the
 * view, a mirror reflect the ground, a window's recess show only its sill.
 */
export function viewDirection(): V3 {
  return normalize(
    mix(positionWorld.sub(cameraPosition), viewRay, viewParallel)
  );
}

/**
 * `viewDirection()` turned round, in view space: from the fragment to the
 * eye, for a material that works beside `normalView`. In perspective it is
 * TSL's `positionViewDirection`; in a parallel projection the view's one
 * direction, where that node — built for the perspective camera the tiles
 * compile with — would look from the camera's place.
 */
export function eyeDirectionView(): V3 {
  return normalize(
    mix(
      positionView.negate(),
      cameraViewMatrix.mul(vec4(viewRay, 0)).xyz.negate(),
      viewParallel
    )
  );
}

/**
 * Hands the materials the camera drawing the frame (each frame, with the
 * post's lens): whether it is a parallel one, and then the direction it
 * looks along, unprojected because three's camera does not know the shear
 * (`view-ray.ts`).
 */
export function setViewDirection(camera: Camera): void {
  const parallel =
    (camera as Camera & { isOrthographicCamera?: boolean })
      .isOrthographicCamera === true;
  viewParallel.value = parallel ? 1 : 0;
  if (parallel) {
    parallelDirection(camera, viewRay.value);
  }
}
