import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import {
  attribute,
  color,
  float,
  fract,
  materialOpacity,
  mix,
  positionLocal,
  smoothstep,
  uniform,
} from "three/tsl";
import type { BridgeFeature, TrafficFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import { rightOf, type TrafficLane, trafficLanes } from "@/lib/city/traffic";
import { mapWidenNode } from "./map-overlay";
import { buildDeckTable, type DeckPoly, deckLift } from "./rail-layer";
import type { F, Live, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * The counted motor traffic (pipeline/bake/traffic.py; Landeshauptstadt
 * Dresden, dl-de/by-2-0) as flowing bands on the road — a data layer
 * (lib/city/data-layers.ts), hidden unless the HUD switches it on.
 *
 * - One band per counted direction, on the right of its travel
 *   (lib/city/traffic.ts): its width grows with the root of the vehicles
 *   per day, its colour runs sage → amber → coral with their logarithm, and
 *   dashes run along it in the direction of travel, longer the busier it
 *   is. A band whose heavy-goods share is high darkens toward plum. A
 *   section with only an undirected total does not flow.
 * - From the air the bands widen (`mapWidenNode`): a 3 m lane stays legible
 *   from 500 m up.
 * - Draped 0.15 m over the ground, sampled every 2 m — a map mark, not a
 *   body: where the ground beside it is higher (a bank) or lower (a raised
 *   carriageway) the band simply follows the ground under its line;
 *   `polygonOffset` keeps it over the road surface it lies on. A section
 *   whose street is a bridge (`br`) rides the deck and its approach ramps
 *   (rail-layer.ts's lift table) where it crosses them; any other street
 *   stays on the ground, so one passing under a railway bridge is not
 *   lifted onto it (and one crossing over a railway on a bridge it is not
 *   named after runs under that deck).
 *
 * Unlit, no shadow, fogged like everything else. Built per fine terrain
 * tile in the Y-up frame on the cross-tile ground; freed with the tile.
 */

/** How far apart the band's cross-sections are (m). */
const SAMPLE_M = 2;
/** Height of the band over the ground or the deck (m). */
const LIFT_M = 0.15;
/** One dash and its gap, along the lane (m). */
const DASH_PERIOD_M = 24;
/** How fast the dashes run (m/s, ~30 km/h). */
const FLOW_SPEED = 8;

const CALM = 0x8f_cf_c0; // sage
const BUSY = 0xf2_c1_6b; // amber
const FULL = 0xe4_6f_5e; // coral
const HEAVY = 0x6d_4f_78; // plum

/** The traffic's own clock (s), shared by every tile's bands. */
const trafficTime: Live = uniform(0);

/** Advances the dashes (the render loop, create-app.ts). */
export function setTrafficTime(seconds: number): void {
  trafficTime.value = seconds;
}

function trafficMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("traffic-band", () => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const along = attribute("trafficAlong", "float") as F;
    const load = attribute("trafficLoad", "float") as F;
    const heavy = attribute("trafficHeavy", "float") as F;
    const flows = attribute("trafficFlow", "float") as F;
    const across = attribute("trafficAcross", "vec3") as V3;
    // Wider from the air: each vertex moves out along its own offset from
    // the section's line, so a lane widens about its centre and the two
    // lanes of a street stay apart.
    m.positionNode = positionLocal.add(across.mul(mapWidenNode().sub(1)));
    const ramp = mix(
      mix(color(CALM), color(BUSY), smoothstep(0, 0.5, load)),
      color(FULL),
      smoothstep(0.5, 1, load)
    ) as V3;
    m.colorNode = mix(ramp, color(HEAVY), heavy.mul(4).clamp(0, 0.6));
    const phase = fract(
      along.sub(trafficTime.mul(FLOW_SPEED).mul(flows)).div(DASH_PERIOD_M)
    );
    // The dash fills more of its period the busier the lane.
    const duty = mix(float(0.2), float(0.75), load);
    const dash = float(1).sub(smoothstep(duty.sub(0.06), duty, phase));
    m.opacityNode = materialOpacity.mul(mix(float(0.32), float(0.92), dash));
    return m;
  });
}

interface Band {
  across: number[];
  along: number[];
  flow: number[];
  heavy: number[];
  index: number[];
  load: number[];
  pos: number[];
}

/** The height a band rides at (x, y): the deck — or its approach ramp —
 *  under a bridge street, else the ground; null where neither is there. */
function rideAt(
  p: Point2,
  onBridge: boolean,
  decks: DeckPoly[],
  ctx: GroundContext
): number | null {
  if (onBridge) {
    const w = epsgToWorld(p[0], p[1], ctx.offset);
    const deck = deckLift(decks, w.x, w.z);
    if (deck !== null) {
      return deck;
    }
  }
  return ctx.heightAt(p[0], p[1]);
}

function addLane(
  band: Band,
  lane: TrafficLane,
  onBridge: boolean,
  decks: DeckPoly[],
  ctx: GroundContext
): void {
  const dense = subdividePolyline(lane.coords, SAMPLE_M);
  let s = 0;
  let prevOk = false;
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i];
    if (i > 0) {
      s += Math.hypot(p[0] - dense[i - 1][0], p[1] - dense[i - 1][1]);
    }
    const right = rightOf(
      dense[Math.max(i - 1, 0)],
      dense[Math.min(i + 1, dense.length - 1)]
    );
    const y = rideAt(p, onBridge, decks, ctx);
    if (y === null || right === null) {
      prevOk = false;
      continue;
    }
    const base = band.pos.length / 3;
    for (const edge of [-1, 1]) {
      // metres to the right of travel of this edge
      const r = lane.offset + (edge * lane.width) / 2;
      const w = epsgToWorld(
        p[0] + right[0] * r,
        p[1] + right[1] * r,
        ctx.offset
      );
      band.pos.push(w.x, y + LIFT_M, w.z);
      // the same offset in the world frame (z = −y)
      band.across.push(right[0] * r, 0, -right[1] * r);
      band.along.push(s);
      band.load.push(lane.load);
      band.heavy.push(lane.heavy);
      band.flow.push(lane.flows ? 1 : 0);
    }
    if (prevOk) {
      band.index.push(base - 2, base - 1, base, base - 1, base + 1, base);
    }
    prevOk = true;
  }
}

/** One tile's traffic bands; an empty group where the tile has no counted
 *  road. Freed with the tile (disposeObject3D). */
export function buildTraffic(
  features: TrafficFeature[],
  bridges: BridgeFeature[],
  ctx: GroundContext
): Group {
  const group = new Group();
  group.name = "traffic";
  const band: Band = {
    across: [],
    along: [],
    flow: [],
    heavy: [],
    index: [],
    load: [],
    pos: [],
  };
  const needsDecks = features.some((f) => f.properties?.br === 1);
  const decks = needsDecks ? buildDeckTable(bridges, ctx) : [];
  for (const f of features) {
    const onBridge = f.properties?.br === 1;
    for (const lane of trafficLanes(f)) {
      addLane(band, lane, onBridge, decks, ctx);
    }
  }
  if (band.index.length === 0) {
    return group;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(band.pos, 3));
  geo.setAttribute("trafficAcross", new Float32BufferAttribute(band.across, 3));
  geo.setAttribute("trafficAlong", new Float32BufferAttribute(band.along, 1));
  geo.setAttribute("trafficLoad", new Float32BufferAttribute(band.load, 1));
  geo.setAttribute("trafficHeavy", new Float32BufferAttribute(band.heavy, 1));
  geo.setAttribute("trafficFlow", new Float32BufferAttribute(band.flow, 1));
  geo.setIndex(band.index);
  geo.computeBoundingSphere();
  // From the air the bands widen up to MAP_WIDEN.max ×: the sphere must
  // hold them then too, or a street at the frame's edge culls out.
  if (geo.boundingSphere) {
    geo.boundingSphere.radius += 20;
  }
  const mesh = new Mesh(geo, trafficMaterial());
  mesh.name = "traffic-bands";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 3; // over the water sheet, like the ferry wakes
  group.add(mesh);
  return group;
}
