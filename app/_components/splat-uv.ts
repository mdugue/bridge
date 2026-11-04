import { uniform } from "three/tsl";
import { Vector2 } from "three/webgpu";
import { dataXY, rasterUv } from "./shader-chunks";
import type { V2 } from "./shader-chunks";
import type { SplatLayer } from "./terrain-layer";

/** The tile's size (m) in the data frame. */
export const splatSize = (splat: SplatLayer): [number, number] => {
  const [minX, minY, maxX, maxY] = splat.bounds;
  return [maxX - minX, maxY - minY];
};

/**
 * The splat uv at the fragment: from the data-frame XY and the tile bounds
 * (v grows southward) — the terrain geometry carries no uv attribute. The
 * tile's north-west corner is a uniform, so every tile builds the same
 * node code (water-layer.ts reads the splat the same way).
 */
export function splatUv(splat: SplatLayer): V2 {
  const minX = splat.bounds[0];
  const maxY = splat.bounds[3];
  const origin = uniform(
    new Vector2(minX - splat.offset.cx, maxY - splat.offset.cy)
  );
  return rasterUv(dataXY(), origin, splatSize(splat));
}
