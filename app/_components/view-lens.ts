import { type Camera, Matrix4, PerspectiveCamera } from "three/webgpu";
import {
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  reference,
  select,
  uniform,
} from "three/tsl";
import type { F, Live } from "./shader-chunks";

/**
 * What the post passes know of the camera (plan 055, ADR 0044): one lens
 * for the perspective camera and Modell's parallel one alike, so the post
 * graph is built once and switching the camera rebuilds nothing.
 *
 * The passes bind to a stand-in camera (`camera`) — GTAO takes the
 * projection matrices by reference, the depth helpers its near and far —
 * and the render loop copies the active camera into it before the post
 * runs. Depth becomes distance by perspective or by parallel projection as
 * the `ortho` uniform says (both formulas in the graph, selected per
 * pixel). Looks that fade with distance (the styles' far field, the ink's
 * thinning) read `fade`: the sample's own distance in perspective, and in a
 * parallel view the distance a 55° camera would look from to show the same
 * picture — everything in it is "that far", wherever it lies.
 */
export interface ViewLens {
  /** the stand-in the passes bind to; never rendered with */
  readonly camera: PerspectiveCamera;
  /** 1 while the active camera is a parallel one */
  readonly ortho: Live;
  /** the equivalent distance (m) a parallel view's far field reads */
  readonly equivalent: Live;
  /** Copies the active camera's projection into the stand-in. */
  update: (active: Camera, equivalentDistance: number) => void;
  /** whether the active camera is a parallel one (as of the last update) */
  isOrtho: () => boolean;
  /** the view-space z (negative ahead) of a depth sample */
  viewZ: (depth: F) => F;
  /** how far ahead a depth sample lies (m, along the view) */
  distance: (depth: F) => F;
  /** the distance a far-field look reads for a sample `z` m ahead */
  fade: (z: F) => F;
}

export function createViewLens(): ViewLens {
  const camera = new PerspectiveCamera(55, 1, 0.3, 6000);
  camera.name = "view-lens";
  const ortho: Live = uniform(0);
  const equivalent: Live = uniform(600);
  const near = reference("near", "float", camera);
  const far = reference("far", "float", camera);
  const viewZ = (depth: F): F =>
    select(
      ortho.greaterThan(0.5),
      orthographicDepthToViewZ(depth, near, far),
      perspectiveDepthToViewZ(depth, near, far)
    );
  let isOrtho = false;
  const scratch = new Matrix4();
  return {
    camera,
    ortho,
    equivalent,
    update: (active, equivalentDistance) => {
      const a = active as Camera & {
        far?: number;
        isOrthographicCamera?: boolean;
        near?: number;
      };
      isOrtho = a.isOrthographicCamera === true;
      ortho.value = isOrtho ? 1 : 0;
      equivalent.value = equivalentDistance;
      camera.near = a.near ?? camera.near;
      camera.far = a.far ?? camera.far;
      // The same Matrix4 objects, written in place: GTAO holds them.
      camera.projectionMatrix.copy(active.projectionMatrix);
      camera.projectionMatrixInverse.copy(
        scratch.copy(active.projectionMatrix).invert()
      );
      camera.matrixWorld.copy(active.matrixWorld);
      camera.matrixWorldInverse.copy(active.matrixWorldInverse);
    },
    isOrtho: () => isOrtho,
    viewZ,
    distance: (depth) => viewZ(depth).negate(),
    fade: (z) => select(ortho.greaterThan(0.5), equivalent, z),
  };
}
