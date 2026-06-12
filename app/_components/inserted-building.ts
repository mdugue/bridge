import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Fallback when no glTF asset is prescribed: an unmissable orange box. */
function createMarkerBox(): Object3D {
  const box = new Mesh(
    new BoxGeometry(14, 28, 14),
    new MeshStandardMaterial({ color: 0xd9_8c_3f, roughness: 0.7 })
  );
  // Box origin is centered; lift it so it stands ON the ground.
  box.position.y = 14;
  box.castShadow = true;
  box.receiveShadow = true;
  const holder = new Group();
  holder.name = "inserted-building";
  holder.add(box);
  return holder;
}

/**
 * Loads the prescribed glTF/GLB (Y-up, meters — add to the Y-up scene, not
 * the Z-up world group) or falls back to a marker box. Shadow flags are
 * enabled on every contained mesh.
 */
export async function createInsertedBuilding(
  modelUrl?: string
): Promise<Object3D> {
  if (!modelUrl) {
    return createMarkerBox();
  }
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  gltf.scene.traverse((obj) => {
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  gltf.scene.name = "inserted-building";
  return gltf.scene;
}
