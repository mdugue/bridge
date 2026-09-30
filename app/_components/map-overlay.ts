import { smoothstep, uniform } from "three/tsl";
import type { F, Live } from "./shader-chunks";

/**
 * The map's own marks in the scene — the ferry lines on the Elbe
 * (riverside-layer.ts) — show only from the air: faded in with the
 * camera's height over the ground, from nothing on foot to full once the
 * view is a map. One module-level uniform node the render loop writes
 * (create-app.ts), like the fountains' clock: every material that reads
 * the fade shares it, and a write is never a rebuild.
 */

/** Height over the ground (m) where the marks start to show, and where
 *  they are full. */
export const MAP_FADE_M = { from: 25, to: 60 } as const;

/** the camera's height over the ground under it (m) */
const mapAltitude: Live = uniform(0);

export function setMapAltitude(metres: number): void {
  mapAltitude.value = metres;
}

/** The fade factor (0 on foot → 1 from the air) from the shared altitude. */
export function mapFadeNode(): F {
  return smoothstep(MAP_FADE_M.from, MAP_FADE_M.to, mapAltitude);
}
