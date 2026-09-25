import { DoubleSide, type Mesh, MeshStandardMaterial } from "three";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

const WALL_COLOR = 0xc9_bd_a4; // warm sandstone

/**
 * Retaining / city walls from OSM, baked with the terrain: the fine terrain
 * glTF carries a `walls` node (lib/city/walls.ts, written by
 * scripts/bake-tiles.ts `wallMesh` against every tile's final ground, so a
 * wall near a seam stands on its neighbour's ground too). This only gives
 * it its material; it arrives and leaves with its tile, and the renderer
 * frees it with the tile's content.
 */
export function dressWalls(mesh: Mesh, heightFog?: HeightFogUniforms): void {
  const material = new MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  });
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  mesh.material = material;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
