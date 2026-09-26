import type { Object3D } from "three/webgpu";
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Matrix3,
  Matrix4,
  Mesh,
  Ray,
  Raycaster,
  Vector3,
} from "three/webgpu";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  type MeshBVH,
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

export interface CityCollider {
  /**
   * The inside test: when world (x, y, z) lies inside a building, the world
   * height of the first surface straight above it (its roof, seen from
   * within), else null.
   */
  roofAbove: (x: number, y: number, z: number) => number | null;
  /** world height of the highest building surface over (x, z), or null */
  topAt: (x: number, z: number) => number | null;
  /**
   * Adjusts a proposed horizontal step so it cannot cross a building wall:
   * unobstructed steps pass through, oblique hits slide along the facade,
   * head-on hits stop.
   */
  resolveStep: (position: Vector3, displacement: Vector3) => Vector3;
}

/** Above every roof of the site: where the top-down rays start (m). */
const SKY_Y = 10_000;

/** A mesh's world box and inverse matrix, kept while it does not move. */
interface MeshFrame {
  box: Box3;
  inverse: Matrix4;
  matrix: Matrix4;
  normal: Matrix3;
}

/**
 * Wall collision against whatever `getTargets` returns — the building meshes
 * of every visible tile — and the vertical rays that keep the camera out of
 * them (camera-pose.ts).
 */
export function createCityCollider(getTargets: () => Object3D[]): CityCollider {
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
      const hit = raycaster.intersectObjects(getTargets(), true)[0];
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

  const frames = new WeakMap<Mesh, MeshFrame>();
  /** The mesh's world frame, refreshed when its matrix changed. */
  const frameOf = (mesh: Mesh): MeshFrame | null => {
    const geometry = mesh.geometry;
    if (!geometry.boundsTree) {
      return null;
    }
    let frame = frames.get(mesh);
    if (!frame?.matrix.equals(mesh.matrixWorld)) {
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
      }
      frame = {
        box: (geometry.boundingBox ?? new Box3())
          .clone()
          .applyMatrix4(mesh.matrixWorld),
        inverse: mesh.matrixWorld.clone().invert(),
        matrix: mesh.matrixWorld.clone(),
        normal: new Matrix3().getNormalMatrix(mesh.matrixWorld),
      };
      frames.set(mesh, frame);
    }
    return frame;
  };

  const worldRay = new Ray();
  const localRay = new Ray();
  const point = new Vector3();
  const normal = new Vector3();
  /**
   * The nearest hit of a vertical ray through (x, z), either face side (a
   * roof seen from inside a building is a back face): its world height and
   * whether its face looks up.
   */
  /** The mesh's frame when a vertical ray through (x, y, z) can meet it. */
  const reachable = (
    target: Object3D,
    x: number,
    y: number,
    z: number,
    up: boolean
  ): MeshFrame | null => {
    const frame = (target as Mesh).isMesh ? frameOf(target as Mesh) : null;
    const box = frame?.box;
    if (
      !box ||
      x < box.min.x ||
      x > box.max.x ||
      z < box.min.z ||
      z > box.max.z ||
      (up ? y > box.max.y : y < box.min.y)
    ) {
      return null;
    }
    return frame;
  };

  const vertical = (
    x: number,
    y: number,
    z: number,
    up: boolean
  ): { y: number; facesUp: boolean } | null => {
    worldRay.origin.set(x, y, z);
    worldRay.direction.set(0, up ? 1 : -1, 0);
    let best: { y: number; facesUp: boolean } | null = null;
    for (const target of getTargets()) {
      const frame = reachable(target, x, y, z, up);
      if (!frame) {
        continue;
      }
      localRay.copy(worldRay).applyMatrix4(frame.inverse);
      // reason: computeBoundsTree (the default) builds a MeshBVH.
      const bvh = (target as Mesh).geometry.boundsTree as MeshBVH | undefined;
      const hit = bvh?.raycastFirst(localRay, DoubleSide);
      if (!hit?.face) {
        continue;
      }
      point.copy(hit.point).applyMatrix4(frame.matrix);
      const closer =
        best === null || (up ? point.y < best.y : point.y > best.y);
      if (closer) {
        normal.copy(hit.face.normal).applyMatrix3(frame.normal);
        best = { y: point.y, facesUp: normal.y > 0 };
      }
    }
    return best;
  };

  return {
    resolveStep,
    // Seen from inside a closed solid, the surface straight above faces up
    // (its outside is above it); from under a bridge or a balcony it faces
    // down.
    roofAbove: (x, y, z) => {
      const hit = vertical(x, y, z, true);
      return hit?.facesUp ? hit.y : null;
    },
    topAt: (x, z) => vertical(x, SKY_Y, z, false)?.y ?? null,
  };
}
