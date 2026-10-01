import { smoothstep, uniform } from "three/tsl";
import type { F, Live } from "./shader-chunks";

/**
 * The map's own marks in the scene follow the camera's height over the
 * ground: the ferry lines on the Elbe (riverside-layer.ts) show only from
 * the air, faded in from nothing on foot to full once the view is a map;
 * the data layers' bands (traffic-layer.ts, tram-layer's timetable cars)
 * widen as the view climbs, so a lane stays a lane from 500 m up. One
 * module-level uniform node the render loop writes (create-app.ts), like
 * the fountains' clock: every material that reads it shares it, and a
 * write is never a rebuild.
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

/** Height over the ground (m) where the data layers' bands start to widen,
 *  and how much wider (×) they get per metre above it, up to `max`. */
export const MAP_WIDEN = { from: 30, perM: 1 / 120, max: 5 } as const;

/**
 * How much wider a map band draws from the current height (1 on foot): a
 * 3 m lane is three pixels from 500 m up, so the data layers (traffic,
 * trams) widen their geometry by this factor in the vertex stage — one
 * shared uniform, never a rebuild.
 */
export function mapWidenNode(): F {
  return mapAltitude
    .sub(MAP_WIDEN.from)
    .mul(MAP_WIDEN.perM)
    .clamp(0, MAP_WIDEN.max - 1)
    .add(1);
}
