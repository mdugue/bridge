import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { enableShadows } from "./three-utils";

/** Fallback when no glTF asset is prescribed (or it fails): an orange box. */
function createMarkerBox(): Object3D {
  const box = new Mesh(
    new BoxGeometry(14, 28, 14),
    new MeshStandardMaterial({ color: 0xd9_8c_3f, roughness: 0.7 })
  );
  // Box origin is centered; lift it so it stands ON the ground.
  box.position.y = 14;
  const holder = new Group();
  holder.name = "inserted-building";
  holder.add(box);
  enableShadows(holder);
  return holder;
}

/**
 * Loads the prescribed glTF/GLB (Y-up, meters — add to the Y-up scene, not
 * the Z-up world group) or falls back to a marker box. Shadow flags are
 * enabled on every contained mesh. Never rejects: a glTF load failure is
 * non-fatal and degrades to the marker box, so callers need no error handling.
 */
export async function createInsertedBuilding(
  modelUrl?: string
): Promise<Object3D> {
  if (!modelUrl) {
    return createMarkerBox();
  }
  try {
    const gltf = await new GLTFLoader().loadAsync(modelUrl);
    enableShadows(gltf.scene);
    gltf.scene.name = "inserted-building";
    return gltf.scene;
  } catch {
    return createMarkerBox();
  }
}
