/**
 * Where the scene's boot starts (create-app.ts `bootApp`): at the site's
 * spawn vantage, where a recovered page's player stood (gpu-safety.ts),
 * or at a place picked in the HUD while the page was loading — and how
 * the camera stands while the boot waits for that place's tile.
 */

import { epsgToWorld, type RecenterOffset } from "./ground-clamp";
import type { CameraState } from "./pose";
import type { ViewpointGeometry } from "./site";

type Tile = { bounds: readonly [number, number, number, number] };

/** Where the boot starts, and the tile it waits for. */
export interface BootStart<T extends Tile> {
  /** a place picked in the HUD while loading (a vantage: its height is
   *  above the ground) */
  picked?: ViewpointGeometry;
  /** a recovered page's camera, or a snapshot's (a height of its own) */
  restored?: CameraState;
  /** the tile the boot waits for: theirs, or the spawn tile */
  spawn: T;
}

/**
 * The tile whose extent holds an EPSG point (a recovered page's camera, a
 * picked place), or undefined off every tile.
 */
function startTileOf<T extends Tile>(
  tiles: readonly T[],
  epsg: { x: number; y: number } | undefined
): T | undefined {
  if (!epsg) {
    return undefined;
  }
  return tiles.find(
    ({ bounds: [x0, y0, x1, y1] }) =>
      epsg.x >= x0 && epsg.x <= x1 && epsg.y >= y0 && epsg.y <= y1
  );
}

/**
 * A given camera wins over a picked place, each only on a tile of the
 * site; off every tile, or with neither, the boot starts on the spawn
 * tile (`tiles[0]`).
 */
export function startOf<T extends Tile>(
  given: { initialCamera?: CameraState; initialView?: ViewpointGeometry },
  tiles: readonly T[]
): BootStart<T> {
  const onCamera = startTileOf(tiles, given.initialCamera?.epsg);
  if (onCamera) {
    return { restored: given.initialCamera, spawn: onCamera };
  }
  const onView = startTileOf(tiles, given.initialView?.epsg);
  if (onView) {
    return { picked: given.initialView, spawn: onView };
  }
  return { spawn: tiles[0] };
}

/**
 * How the camera stands while the boot waits for its tile. The renderer
 * loads only the tiles in the camera's view, and before any terrain has
 * landed the ground under a vantage is not known (it falls back to the
 * floor, 0 m), so a vantage's height above it may put the camera far
 * below the tile's box. A pose that sees no tile loads none — and by
 * night, on a phone, or from safety level 2, no shadow camera streams
 * one either — so the boot would wait for ever.
 *
 * - the spawn: its own vantage, which looks across its tile;
 * - a recovered camera: where it stood (its height is its own), looking
 *   straight down onto its tile;
 * - a picked place: above the top of its tile (`tileTop`) by its height
 *   over the ground, in the air, looking straight down onto it. Without
 *   that top (a tileset without boxes) its own vantage, as the spawn.
 *
 * Either stands no higher above the tile's top than half the boot's
 * stream `reach` (create-app.ts: where its stream camera's far plane
 * ends — on a phone 2.2 km at most, lib/city/atmosphere.ts): from higher
 * the tile lies past that plane, out of the view, and the boot would wait
 * for ever the same way.
 *
 * Each goes on its own pose once the tile has landed.
 */
export function bootingPose(
  start: Pick<BootStart<Tile>, "picked" | "restored">,
  spawnView: ViewpointGeometry,
  tileTop: number | undefined,
  offset: RecenterOffset,
  reach: number
): { camera: CameraState } | { view: ViewpointGeometry } {
  const { picked, restored } = start;
  /** At most half the reach above the tile's top. */
  const within = (y: number) =>
    tileTop === undefined ? y : Math.min(y, tileTop + reach / 2);
  if (restored) {
    const { pos } = restored;
    return {
      camera: { ...restored, pitchDeg: -90, pos: { ...pos, y: within(pos.y) } },
    };
  }
  if (!picked) {
    return { view: spawnView };
  }
  if (tileTop === undefined) {
    return { view: picked };
  }
  const at = epsgToWorld(picked.epsg.x, picked.epsg.y, offset);
  return {
    camera: {
      epsg: { ...picked.epsg },
      fov: picked.fov,
      headingDeg: picked.headingDeg,
      mode: "fly",
      pitchDeg: -90,
      pos: {
        x: at.x,
        y: within(tileTop + Math.max(picked.aboveGround, 0)),
        z: at.z,
      },
    },
  };
}
