import type { BufferGeometry, Material, Object3D } from "three";

/** Turns on shadow casting/receiving for every mesh in a loaded subtree. */
export function enableShadows(
  root: Object3D,
  { cast = true, receive = true }: { cast?: boolean; receive?: boolean } = {}
): void {
  root.traverse((obj) => {
    obj.castShadow = cast;
    obj.receiveShadow = receive;
  });
}

function disposeMaterial(material: Material | Material[] | undefined): void {
  if (Array.isArray(material)) {
    for (const m of material) {
      disposeMaterial(m);
    }
    return;
  }
  // Style materials are shared across demolish-reloads; freeing them here
  // would force a shader recompile (or break textures) on the next frame.
  if (material && !material.userData.shared) {
    material.dispose();
  }
}

/**
 * Frees GPU resources of a subtree. Needed because demolish works by
 * disposing the whole loader output and re-parsing the filtered CityJSON —
 * without this every demolish would leak buffers.
 */
export function disposeObject3D(root: Object3D): void {
  root.traverse((obj) => {
    const resource = obj as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    // Free the three-mesh-bvh acceleration structure too (terrain/city picks
    // and collision build one) — geometry.dispose() alone leaves it on the heap.
    if (resource.geometry?.boundsTree) {
      resource.geometry.disposeBoundsTree();
    }
    resource.geometry?.dispose();
    disposeMaterial(resource.material);
  });
}
