import { type Mesh, MeshStandardMaterial } from "three";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import {
  type GroundLight,
  groundLightKey,
  injectGroundLight,
} from "./sky-light";

const KERB_COLOR = 0xd9_d5_cc; // pale granite, a shade above the pavement

/**
 * The kerb stones along the carriageway, baked with the terrain: the fine
 * terrain glTF carries a `kerbs` node (lib/city/kerbs.ts, written by
 * scripts/bake-tiles.ts `kerbMesh` on the final ground). This only gives it
 * its material; it arrives and leaves with its tile. It casts: the low
 * step's shadow on the road is what makes the pavement read as raised. It
 * takes the tile's baked light as the ground does (`light`, sky-light.ts):
 * a kerb on a far-shadowed street is shadowed with it.
 */
export function dressKerbs(
  mesh: Mesh,
  heightFog?: HeightFogUniforms,
  light?: GroundLight
): void {
  const material = new MeshStandardMaterial({
    color: KERB_COLOR,
    roughness: 0.9,
    metalness: 0,
  });
  const key = `kerb-${groundLightKey(light, true)}-${heightFog !== undefined}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (sh) => {
    injectGroundLight(sh, light, true);
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  mesh.material = material;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
