import type { Texture, Vector2 } from "three/webgpu";
import { positionWorld, vec2, vec3 } from "three/tsl";
import type { Node, UniformNode } from "three/webgpu";

/**
 * The TSL pieces every layer's node material shares.
 *
 * The data frame (x east, y north, z up, recentered) comes from world
 * space, never from `position`: the streamed glTF positions are quantised
 * with the dequantisation on the node, and the viewer's `world` group only
 * rotates −90° about X, so world (x, y, z) is data (x, −z, y) exactly — the
 * same expression on the Z-up tiles and the Y-up dressing.
 */

export type F = Node<"float">;
export type V2 = Node<"vec2">;
export type V3 = Node<"vec3">;
export type V4 = Node<"vec4">;

/** A float uniform the look (or the sun rig) writes; `.value` is live. */
export type Live = UniformNode<"float", number>;

/** The fragment's (or vertex's) data-frame XY: world (x, −z). */
export const dataXY = (): V2 => vec2(positionWorld.x, positionWorld.z.negate());

/** The data-frame position: world (x, −z, y). */
export const dataPosition = (): V3 =>
  vec3(positionWorld.x, positionWorld.z.negate(), positionWorld.y);

/**
 * A tile raster's uv at data-frame `xy` (v grows southward). The corner is
 * a uniform, not a constant: every tile then builds the same shader (the
 * tiles share their size), and a tile flown into reuses the pipeline the
 * first one built.
 */
export function rasterUv(
  xy: V2,
  origin: UniformNode<"vec2", Vector2>,
  size: [number, number]
): V2 {
  return vec2(xy.x.sub(origin.x).div(size[0]), origin.y.sub(xy.y).div(size[1]));
}

/** A texture's pixel size. */
export const texSize = (t: Texture): [number, number] => {
  const img = t.image as { height: number; width: number };
  return [img.width, img.height];
};
