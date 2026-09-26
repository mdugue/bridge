import { DoubleSide, type Mesh } from "three/webgpu";
import { type GroundLight, groundLitMaterial } from "./sky-light";

/**
 * Flights of steps from OSM (`pipeline/bake/stairs.py`), baked with the
 * terrain: the fine terrain glTF carries a `stairs` node next to its grid
 * (scripts/bake-tiles.ts `stairMesh`), built by the same code that lowers
 * the ground under each flight, so the two can never disagree. The mesh
 * comes with its stone shades as vertex colours (lib/city/stairs.ts
 * `stairColors`); this only gives it its material, lit by the tile's baked
 * light as the ground is (`light`, sky-light.ts). It arrives and leaves
 * with its tile, and the renderer frees it with the tile's content.
 */
export function dressStairs(mesh: Mesh, light?: GroundLight): void {
  mesh.material = groundLitMaterial(
    { vertexColors: true, roughness: 0.92, metalness: 0, side: DoubleSide },
    light,
    true
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
