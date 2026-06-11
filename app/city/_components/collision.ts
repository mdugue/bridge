import type { Object3D } from "three";
import { BufferGeometry, Matrix3, Mesh, Raycaster, Vector3 } from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import { horizontalSlide } from "@/lib/city/collision";

// Global three-mesh-bvh wiring: meshes WITH a boundsTree raycast through the
// BVH; everything else keeps the stock path. Also accelerates demolish picks.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

/** Body radius the player keeps from facades. */
const BODY_RADIUS = 0.6;
/** Second ray below the eye so low parts/roof edges on slopes still block. */
const KNEE_DROP = 1.2;
const MIN_STEP_SQ = 1e-10;

/** Builds BVHs for all batched city meshes that don't have one yet. */
export function buildCityBvh(root: Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Mesh & { isCityObjectMesh?: boolean };
    if (mesh.isCityObjectMesh && !mesh.geometry.boundsTree) {
      mesh.geometry.computeBoundsTree();
    }
  });
}

export interface CityCollider {
  /**
   * Adjusts a proposed horizontal step so it cannot cross a building wall:
   * unobstructed steps pass through, oblique hits slide along the facade,
   * head-on hits stop.
   */
  resolveStep: (position: Vector3, displacement: Vector3) => Vector3;
}

export function createCityCollider(getCity: () => Object3D): CityCollider {
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const normalMatrix = new Matrix3();
  const dir = new Vector3();
  const origin = new Vector3();

  /** World-space wall normal when the step is blocked, else null. */
  const blockingNormal = (
    position: Vector3,
    displacement: Vector3
  ): Vector3 | null => {
    const distance = displacement.length();
    dir.copy(displacement).normalize();
    raycaster.far = distance + BODY_RADIUS;
    for (const drop of [0, KNEE_DROP]) {
      origin.copy(position);
      origin.y -= drop;
      raycaster.set(origin, dir);
      const hit = raycaster.intersectObject(getCity(), true)[0];
      if (hit?.face) {
        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      }
    }
    return null;
  };

  const resolveStep = (position: Vector3, displacement: Vector3): Vector3 => {
    if (displacement.lengthSq() < MIN_STEP_SQ) {
      return displacement;
    }
    const wall = blockingNormal(position, displacement);
    if (!wall) {
      return displacement;
    }
    const slid = horizontalSlide(
      { x: displacement.x, z: displacement.z },
      { x: wall.x, z: wall.z }
    );
    const slidStep = new Vector3(slid.x, 0, slid.z);
    if (slidStep.lengthSq() < MIN_STEP_SQ) {
      return new Vector3();
    }
    // The slide direction may graze into a second wall (inner corners).
    return blockingNormal(position, slidStep) ? new Vector3() : slidStep;
  };

  return { resolveStep };
}
