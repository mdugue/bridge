import { type Mesh, MeshStandardMaterial } from "three";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

const KERB_COLOR = 0xd9_d5_cc; // pale granite, a shade above the pavement

/**
 * The kerb stones along the carriageway, baked with the terrain: the fine
 * terrain glTF carries a `kerbs` node (lib/city/kerbs.ts, written by
 * scripts/bake-tiles.ts `kerbMesh` on the final ground). This only gives it
 * its material; it arrives and leaves with its tile. It casts: the low
 * step's shadow on the road is what makes the pavement read as raised.
 */
export function dressKerbs(mesh: Mesh, heightFog?: HeightFogUniforms): void {
  const material = new MeshStandardMaterial({
    color: KERB_COLOR,
    roughness: 0.9,
    metalness: 0,
  });
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  mesh.material = material;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
