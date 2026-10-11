import type { Intersection, Object3D } from "three/webgpu";
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
  MeshBVH,
} from "three-mesh-bvh";
import { horizontalSlide } from "@/lib/city/collision";

// Global three-mesh-bvh wiring: meshes WITH a boundsTree raycast through the
// BVH; everything else keeps the stock path. Also accelerates demolish picks.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

/**
 * The bytes the BVHs under `root` hold on the page's process: their node
 * buffers (the index a BVH sorts is its geometry's own, counted there).
 * Read through `serialize` without copies — a reference to the buffers.
 */
export function bvhBytesUnder(root: Object3D): number {
  const seen = new Set<BufferGeometry>();
  let bytes = 0;
  root.traverse((object) => {
    const geometry = (object as Mesh).geometry as BufferGeometry | undefined;
    // reason: computeBoundsTree (the default) builds a MeshBVH.
    const bvh = geometry?.boundsTree as MeshBVH | undefined;
    if (!(geometry && bvh) || seen.has(geometry)) {
      return;
    }
    seen.add(geometry);
    const { roots, indirectBuffer } = MeshBVH.serialize(bvh, {
      cloneBuffers: false,
    });
    for (const buffer of roots) {
      bytes += buffer.byteLength;
    }
    bytes += indirectBuffer?.byteLength ?? 0;
  });
  return bytes;
}

const exitOrEntry = new Vector3();

/**
 * How far along `ray` it enters `box`, or null where it misses: 0 from
 * inside it. three's `intersectBox` gives the exit point there — and the
 * player's eye stands inside its own building tile's box: by that, the
 * tile's walls lay hundreds of metres off, past a step's reach.
 */
export function rayEntry(ray: Ray, box: Box3): number | null {
  if (box.containsPoint(ray.origin)) {
    return 0;
  }
  return ray.intersectBox(box, exitOrEntry)
    ? exitOrEntry.distanceTo(ray.origin)
    : null;
}

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
   * Distance along a world ray (unit direction) to the first building
   * surface, or null within `far`.
   */
  along: (origin: Vector3, direction: Vector3, far: number) => number | null;
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
 * them (camera-pose.ts). A ray asks only the targets whose box it reaches,
 * and those through their BVH: one without is built first by `build`
 * (city-layer.ts `ensureCityBvh` — a building tile gets its BVH when a ray
 * first needs it) and passed over without it, never walked triangle by
 * triangle (three-mesh-bvh's raycast falls back to that on a mesh with no
 * BVH: two million triangles a ray, every frame).
 */
export function createCityCollider(
  getTargets: () => Object3D[],
  build?: (mesh: Mesh) => void
): CityCollider {
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const normalMatrix = new Matrix3();
  const dir = new Vector3();
  const origin = new Vector3();

  const frames = new WeakMap<Mesh, MeshFrame>();
  /** The mesh's world frame, refreshed when its matrix changed. */
  const frameOf = (mesh: Mesh): MeshFrame => {
    const geometry = mesh.geometry;
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

  /** Whether a mesh a ray reaches has its BVH, built now where it may. */
  const withBvh = (mesh: Mesh): boolean => {
    if (!mesh.geometry.boundsTree) {
      build?.(mesh);
    }
    return Boolean(mesh.geometry.boundsTree);
  };

  /**
   * The raycaster's first hit within its `far`: the targets whose box the
   * ray enters (from inside one, at once), nearest entry first, until none
   * ahead can hold a nearer hit — so a long ray (a dolly's) builds only
   * the tiles before its hit.
   */
  const firstHit = (): Intersection | null => {
    const { ray, far } = raycaster;
    const reached: { enter: number; mesh: Mesh }[] = [];
    for (const target of getTargets()) {
      const mesh = target as Mesh;
      const enter = mesh.isMesh ? rayEntry(ray, frameOf(mesh).box) : null;
      if (enter !== null && enter <= far) {
        reached.push({ enter, mesh });
      }
    }
    reached.sort((a, b) => a.enter - b.enter);
    let best: Intersection | null = null;
    for (const { enter, mesh } of reached) {
      if (best && enter > best.distance) {
        break;
      }
      const hit = withBvh(mesh)
        ? raycaster.intersectObject(mesh, false)[0]
        : undefined;
      if (hit && (!best || hit.distance < best.distance)) {
        best = hit;
      }
    }
    return best;
  };

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
      const hit = firstHit();
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

  const worldRay = new Ray();
  const localRay = new Ray();
  const point = new Vector3();
  const normal = new Vector3();
  /**
   * The nearest hit of a vertical ray through (x, z), either face side (a
   * roof seen from inside a building is a back face): its world height and
   * whether its face looks up.
   */
  /** The mesh's frame when a vertical ray through (x, y, z) can meet it,
   *  its BVH ready. */
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
    return withBvh(target as Mesh) ? frame : null;
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
    along: (from, direction, far) => {
      raycaster.set(from, direction);
      raycaster.far = far;
      return firstHit()?.distance ?? null;
    },
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
