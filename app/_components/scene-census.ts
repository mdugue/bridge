import type { Mesh, Object3D } from "three/webgpu";
import { isInstances } from "./instancing";

/** Counts of what a set of scene roots actually contain (built, not rendered). */
export interface SceneCensus {
  /** instances of every instanced set (sum of its `drawCount`) */
  instances: number;
  /** Mesh objects, instanced sets included */
  meshes: number;
  /** triangles, with instanced geometry multiplied by its instance count */
  triangles: number;
}

function triangleCount(mesh: Mesh): number {
  const geometry = mesh.geometry;
  const index = geometry.getIndex();
  const vertices = index
    ? index.count
    : (geometry.getAttribute("position")?.count ?? 0);
  return Math.floor(vertices / 3);
}

/**
 * Walks the given roots and tallies every mesh and instanced set. The e2e suite
 * asserts on these per layer: a loader that swallowed a 404 or a renamed
 * property into an empty group shows up as zeros here instead of passing.
 */
export function sceneCensus(roots: Object3D[]): SceneCensus {
  const census: SceneCensus = { instances: 0, meshes: 0, triangles: 0 };
  for (const root of roots) {
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      census.meshes += 1;
      const tris = triangleCount(mesh);
      if (isInstances(obj)) {
        census.instances += obj.drawCount;
        census.triangles += tris * obj.drawCount;
      } else {
        census.triangles += tris;
      }
    });
  }
  return census;
}
