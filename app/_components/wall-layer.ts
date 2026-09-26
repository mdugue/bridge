import { DoubleSide, type Mesh, MeshStandardMaterial } from "three";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import {
  type GroundLight,
  groundLightKey,
  injectGroundLight,
} from "./sky-light";

const WALL_COLOR = 0xc9_bd_a4; // warm sandstone

/**
 * Retaining / city walls from OSM, baked with the terrain: the fine terrain
 * glTF carries a `walls` node (lib/city/walls.ts, written by
 * scripts/bake-tiles.ts `wallMesh` against every tile's final ground, so a
 * wall near a seam stands on its neighbour's ground too). This only gives
 * it its material; it arrives and leaves with its tile, and the renderer
 * frees it with the tile's content. The far horizon cuts its sun as it
 * cuts the ground's (`light`, sky-light.ts); the sky view does not dim it:
 * the ground's raster at a wall's foot counts the wall itself, which would
 * darken every wall by half (the facades correct for that, lib/city/
 * skyview.ts `facadeSkyView`; a wall is too low to be worth it).
 */
export function dressWalls(
  mesh: Mesh,
  heightFog?: HeightFogUniforms,
  light?: GroundLight
): void {
  const material = new MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  });
  const key = `walls-${groundLightKey(light, false)}-${heightFog !== undefined}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (sh) => {
    injectGroundLight(sh, light, false);
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  mesh.material = material;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
