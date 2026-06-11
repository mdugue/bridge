import type { BufferGeometry, Material, Object3D } from "three";

function disposeMaterial(material: Material | Material[] | undefined): void {
  if (Array.isArray(material)) {
    for (const m of material) {
      m.dispose();
    }
  } else {
    material?.dispose();
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
    resource.geometry?.dispose();
    disposeMaterial(resource.material);
  });
}
