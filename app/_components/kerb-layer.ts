import type { Mesh } from "three/webgpu";
import { type GroundLight, groundLitMaterial } from "./sky-light";

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
export function dressKerbs(mesh: Mesh, light?: GroundLight): void {
  mesh.material = groundLitMaterial(
    { color: KERB_COLOR, roughness: 0.9, metalness: 0 },
    light,
    true
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
