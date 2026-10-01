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
  mix,
  positionLocal,
  smoothstep,
  vec3,
} from "three/tsl";
import type { BridgeFeature, TrafficFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import {
  flowHeight,
  flowProfile,
  flowTaper,
  openEnds,
  rightOf,
  TRAFFIC_TINTS,
  type TrafficLane,
  trafficLanes,
} from "@/lib/city/traffic";
import { dataTime, glassColour, glassGrazing } from "./glass";
import { mapWidenNode } from "./map-overlay";
import { buildDeckTable, type DeckPoly, deckLift } from "./rail-layer";
import type { F, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * The counted motor traffic (pipeline/bake/traffic.py; Landeshauptstadt
 * Dresden, dl-de/by-2-0) as bodies of tinted glass flowing along the
 * streets — a data layer (lib/city/data-layers.ts), hidden unless the HUD
 * switches it on.
 *
 * - One body per counted direction, on the right of its travel
 *   (lib/city/traffic.ts): a soft dome in cross-section whose width and
 *   height both grow with the root of the vehicles per day (a street with
 *   four times the traffic is twice as wide and twice as tall), tapering
 *   to a round point only where the flow really ends — where no other
 *   counted section runs on and the tile's edge did not cut it
 *   (lib/city/traffic.ts `openEnds`). Its tint runs sage → peach → coral with
 *   the logarithm of the traffic, plum where the heavy-goods share is high.
 * - The glass (glass.ts) bends and tints the street, the trees and the
 *   houses behind it rather than covering them; its rim brightens where
 *   the eye grazes it.
 * - Light runs through it in the direction of travel — soft comets, more
 *   and brighter the busier the street; a section with only an undirected
 *   total holds its light still.
 * - From the air the bodies widen (`mapWidenNode`): a lane stays a lane
 *   from 500 m up.
 * - A body sits on the ground under its line, its feet 0.2 m under it
 *   (ADR 0035's box row), sampled every 2 m: where the ground beside it is
 *   higher, a bank buries that flank; where it is lower, the flank stands
 *   free of it — a data body follows its line, not the kerb. A section on
 *   a street named a bridge (`br`) rides the deck and its approach ramps
 *   (rail-layer.ts's lift table) where it crosses them; any other street
 *   stays on the ground.
 *
 * Unlit (the glass carries the light of what is behind it), no shadow,
 * fogged like everything else. Built per fine terrain tile in the Y-up
 * frame on the cross-tile ground; freed with the tile.
 */

/**
 * How finely a body is built: on the fine terrain level a cross-section
 * every 2 m with ten segments over the crown; on the coarse level — the
 * tiles the fine one has not reached, seen from afar or from the air — every
 * 8 m with six, about a seventh of the vertices. 3D Tiles swaps the two
 * with their terrain (REPLACE), so the flow never ends at a tile the fine
 * level has not loaded yet.
 */
export type TrafficDetail = "coarse" | "fine";
const DETAIL: Record<TrafficDetail, { profile: number; sample: number }> = {
  fine: { sample: 2, profile: 10 },
  coarse: { sample: 8, profile: 6 },
};
/** How deep the feet go under the ground or the deck (m). */
const FOOT_SINK_M = 0.2;
/** The light's period along the lane at no traffic (m), and how fast it
 *  runs (m/s, ~40 km/h). */
const PULSE_PERIOD_M = 36;
const PULSE_SPEED = 11;

const { calm: CALM, busy: BUSY, full: FULL, heavy: HEAVY } = TRAFFIC_TINTS;

function trafficMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("traffic-glass", () => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    const along = attribute("trafficAlong", "float") as F;
    const load = attribute("trafficLoad", "float") as F;
    const heavy = attribute("trafficHeavy", "float") as F;
    const flows = attribute("trafficFlow", "float") as F;
    const rise = attribute("trafficRise", "float") as F;
    const across = attribute("trafficAcross", "vec3") as V3;
    // Wider from the air: each vertex moves out along its own offset from
    // the section's line, so a body widens about its centre and the two
    // directions of a street stay apart.
    m.positionNode = positionLocal.add(across.mul(mapWidenNode().sub(1)));
    const ramp = mix(
      mix(color(CALM), color(BUSY), smoothstep(0, 0.5, load)),
      color(FULL),
      smoothstep(0.5, 1, load)
    ) as V3;
    const tint = mix(ramp, color(HEAVY), heavy.mul(4).clamp(0, 0.6)) as V3;
    const glass = glassColour({
      tint,
      density: load.mul(0.3).add(0.22),
      rim: 0.8,
    });
    // The light: comets running with the traffic, more of them the busier
    // the lane (the period shrinks to a third), brightest along the crown
    // and fading toward the feet; a still glow where nothing flows.
    const period = float(PULSE_PERIOD_M).div(load.mul(2).add(1));
    const phase = fract(
      along.sub(dataTime.mul(PULSE_SPEED).mul(flows)).div(period)
    );
    const comet = smoothstep(0, 0.08, phase).mul(
      float(1).sub(smoothstep(0.08, 0.55, phase))
    );
    const pulse = mix(float(0.35), comet, flows);
    const core = smoothstep(0.15, 0.9, rise).mul(
      float(1).sub(glassGrazing().mul(0.7))
    );
    const light = mix(tint, vec3(1), 0.35).mul(
      pulse.mul(core).mul(load.mul(0.45).add(0.2))
    );
    m.colorNode = glass.add(light);
    return m;
  });
}

interface Body {
  across: number[];
  along: number[];
  flow: number[];
  heavy: number[];
  index: number[];
  load: number[];
  pos: number[];
  rise: number[];
}

/** The height a body stands on at (x, y): the deck — or its approach ramp
 *  — under a bridge street, else the ground; null where neither is there. */
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

const PROFILES: Record<TrafficDetail, [number, number][]> = {
  fine: flowProfile(DETAIL.fine.profile),
  coarse: flowProfile(DETAIL.coarse.profile),
};

/** The lane's samples: point, distance along, and the size of the taper
 *  there (0 at the ends, 1 inside, a quarter circle between). */
function samples(
  lane: TrafficLane,
  step: number
): { at: number; p: Point2; size: number }[] {
  const dense = subdividePolyline(lane.coords, step);
  const dist = [0];
  for (let i = 1; i < dense.length; i++) {
    dist.push(
      dist[i - 1] +
        Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1])
    );
  }
  const length = dist.at(-1) ?? 0;
  const taper = flowTaper(length);
  const [openStart, openEnd] = lane.open;
  return dense.map((p, i) => {
    // only an open end tapers: one running on stays full
    const edge = Math.min(
      openStart ? dist[i] : Number.POSITIVE_INFINITY,
      openEnd ? length - dist[i] : Number.POSITIVE_INFINITY
    );
    const t = taper > 0 ? Math.min(edge / taper, 1) : 1;
    return { at: dist[i], p, size: Math.sqrt(Math.max(t, 0) * (2 - t)) };
  });
}

function addLane(
  body: Body,
  lane: TrafficLane,
  onBridge: boolean,
  decks: DeckPoly[],
  ctx: GroundContext,
  detail: TrafficDetail
): void {
  const profile = PROFILES[detail];
  const ring = profile.length;
  const height = flowHeight(lane.dtv);
  const pts = samples(lane, DETAIL[detail].sample);
  let prevOk = false;
  for (let i = 0; i < pts.length; i++) {
    const { at, p, size } = pts[i];
    const right = rightOf(
      pts[Math.max(i - 1, 0)].p,
      pts[Math.min(i + 1, pts.length - 1)].p
    );
    const ground = rideAt(p, onBridge, decks, ctx);
    if (ground === null || right === null) {
      prevOk = false;
      continue;
    }
    const base = body.pos.length / 3;
    const half = (lane.width / 2) * size;
    for (const [u, v] of profile) {
      // metres to the right of travel of this vertex
      const r = lane.offset + u * half;
      const w = epsgToWorld(
        p[0] + right[0] * r,
        p[1] + right[1] * r,
        ctx.offset
      );
      body.pos.push(w.x, ground - FOOT_SINK_M + v * height * size, w.z);
      // the same offset in the world frame (z = −y)
      body.across.push(right[0] * r, 0, -right[1] * r);
      body.along.push(at);
      body.rise.push(v);
      body.load.push(lane.load);
      body.heavy.push(lane.heavy);
      body.flow.push(lane.flows ? 1 : 0);
    }
    if (prevOk) {
      for (let k = 0; k < ring - 1; k++) {
        const a = base - ring + k;
        const b = base + k;
        // wound so the outside faces out (forward × up points to the
        // right of travel on the right flank)
        body.index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    prevOk = true;
  }
}

/** One tile's traffic bodies; an empty group where the tile has no
 *  counted road. Freed with the tile (disposeObject3D). */
export function buildTraffic(
  features: TrafficFeature[],
  bridges: BridgeFeature[],
  ctx: GroundContext,
  detail: TrafficDetail = "fine",
  /** the tile's extent: a section cut at its edge runs on into the
   *  neighbour and does not taper there */
  bounds?: readonly [number, number, number, number]
): Group {
  const group = new Group();
  group.name = "traffic";
  const body: Body = {
    across: [],
    along: [],
    flow: [],
    heavy: [],
    index: [],
    load: [],
    pos: [],
    rise: [],
  };
  const needsDecks = features.some((f) => f.properties?.br === 1);
  const decks = needsDecks ? buildDeckTable(bridges, ctx) : [];
  const open = openEnds(features, bounds);
  for (const [i, f] of features.entries()) {
    const onBridge = f.properties?.br === 1;
    for (const lane of trafficLanes(f, open[i])) {
      addLane(body, lane, onBridge, decks, ctx, detail);
    }
  }
  if (body.index.length === 0) {
    return group;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(body.pos, 3));
  geo.setAttribute("trafficAcross", new Float32BufferAttribute(body.across, 3));
  geo.setAttribute("trafficAlong", new Float32BufferAttribute(body.along, 1));
  geo.setAttribute("trafficRise", new Float32BufferAttribute(body.rise, 1));
  geo.setAttribute("trafficLoad", new Float32BufferAttribute(body.load, 1));
  geo.setAttribute("trafficHeavy", new Float32BufferAttribute(body.heavy, 1));
  geo.setAttribute("trafficFlow", new Float32BufferAttribute(body.flow, 1));
  geo.setIndex(body.index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // From the air the bodies widen up to MAP_WIDEN.max ×: the sphere must
  // hold them then too, or a street at the frame's edge culls out.
  if (geo.boundingSphere) {
    geo.boundingSphere.radius += 20;
  }
  const mesh = new Mesh(geo, trafficMaterial());
  mesh.name = `traffic-flows-${detail}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // After the water sheet (renderOrder 3, like the ferry wakes): the
  // glass's copy of the frame then holds the river too.
  mesh.renderOrder = 4;
  group.add(mesh);
  return group;
}
