import type { Group, Mesh } from "three/webgpu";
import { attribute, positionLocal, uniform, vec3 } from "three/tsl";
import { mapWidenNode } from "./map-overlay";
import type { Live, V3, V4 } from "./shader-chunks";

/**
 * What the rest of the scene reads of the counted traffic's flows, apart
 * from the layer that builds them: the hour they keep, where a body's
 * vertex stands at it, the attributes that say so, and how to find a
 * tile's flow mesh. The asked section's outline (selection-outline.ts)
 * draws with the same position node and is compiled at boot, long before
 * the layer's first switch-on; the bodies themselves (traffic-layer.ts)
 * belong to the data layers' feature (data-layers-feature.ts).
 */

/** How the flows stand at the scene's hour (lib/city/traffic-hours.ts):
 *  the traffic as a multiple of the day's average hour, and how far the
 *  light has run (m) — integrated on the CPU, so a change of speed never
 *  jumps the comets. One pair for every tile's flows. */
export const trafficNow: Live = uniform(1);
export const trafficTravel: Live = uniform(0);

/** The scene's hour moved on: how busy (`factor`, 1 = the day's average
 *  hour) and how far the light has run since the start (m). */
export function setTrafficClock(factor: number, travel: number): void {
  trafficNow.value = factor;
  trafficTravel.value = travel;
}

/** The body's size against its daily one, with the hour: the root of the
 *  traffic (like its build), from a third at night to half again at the
 *  peak. */
export const GROW = { min: 0.35, max: 1.5 } as const;

/**
 * The bodies' vertex attributes beside `position` and `normal`, packed:
 * WebGPU's default limit is eight vertex buffers a draw (three asks for
 * no more), and each attribute is one — ten single floats drew nothing
 * on a real GPU while WebGL2 (sixteen) drew them. Kept at or under six.
 *
 * - `trafficAcross` (vec3): the vertex's offset from the section's line
 *   in the world frame (it widens about the line)
 * - `trafficLane` (vec4): metres along the lane, the profile's rise 0..1,
 *   metres over the feet, 1 where the lane flows
 * - `trafficCount` (vec3): the daily load 0..1 on the colour scale, the
 *   vehicles per day, the heavy share
 */
export const TRAFFIC_ATTRIBUTES = [
  "trafficAcross",
  "trafficLane",
  "trafficCount",
] as const;

/**
 * Where a body's vertex stands at the hour: each vertex moves along its
 * own offset from the section's line (wider from the air, too — the two
 * directions of a street stay apart) and its own height over the feet.
 * The flows' material draws with it, and so does the asked section's
 * outline (selection-outline.ts), so the line follows the body as drawn.
 */
export function trafficPositionNode(): V3 {
  const lane = attribute("trafficLane", "vec4") as V4;
  const across = attribute("trafficAcross", "vec3") as V3;
  const grow = trafficNow.sqrt().clamp(GROW.min, GROW.max);
  return positionLocal
    .add(across.mul(mapWidenNode().mul(grow).sub(1)))
    .add(vec3(0, lane.z.mul(grow.sub(1)), 0));
}

/** The tile's flow bodies (traffic-layer.ts): the one mesh that carries
 *  the vertex → section table, or none. */
export function trafficMesh(group: Group | undefined): Mesh | null {
  let found: Mesh | null = null;
  group?.traverse((o) => {
    if (!found && (o as Mesh).isMesh && o.userData.trafficSection) {
      found = o as Mesh;
    }
  });
  return found;
}
