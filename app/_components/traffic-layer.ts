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
  floor,
  fract,
  hash,
  log,
  mix,
  positionLocal,
  smoothstep,
  step,
  uniform,
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
  TRAFFIC_HEAVY_TINT,
  TRAFFIC_SCALE,
  type TrafficLane,
  trafficLanes,
} from "@/lib/city/traffic";
import { glassColour, glassGrazing } from "./glass";
import { mapWidenNode } from "./map-overlay";
import { buildDeckTable, type DeckPoly, deckLift } from "./rail-layer";
import type { F, Live, V3, V4 } from "./shader-chunks";
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
 *   (lib/city/traffic.ts `openEnds`). Its tint runs sage → peach → coral →
 *   rose → wine over five stops of the traffic (`TRAFFIC_SCALE`), slate
 *   where the heavy-goods share is high.
 * - The flows keep the scene's hour (lib/city/traffic-hours.ts): the
 *   counts are per day, the bodies show the hour's share of it on a
 *   typical daily curve — slim, pale and nearly dark at night, full and
 *   deep-coloured at the rush hours. Size, colour and light follow the
 *   hour in the shader (two shared uniforms); nothing is rebuilt.
 * - The glass (glass.ts) bends and tints the street, the trees and the
 *   houses behind it rather than covering them; its rim brightens where
 *   the eye grazes it.
 * - Light runs through it in the direction of travel — soft comets, more
 *   and brighter the busier the street, fewer lit at night and slower at
 *   the peaks; a section with only an undirected total holds its light
 *   still.
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
/** The light's period along the lane at no traffic (m); how fast it runs
 *  is the hour's (lib/city/traffic-hours.ts `trafficSpeed`). */
const PULSE_PERIOD_M = 36;

/** How the flows stand at the scene's hour (lib/city/traffic-hours.ts):
 *  the traffic as a multiple of the day's average hour, and how far the
 *  light has run (m) — integrated on the CPU, so a change of speed never
 *  jumps the comets. One pair for every tile's flows. */
const trafficNow: Live = uniform(1);
const trafficTravel: Live = uniform(0);

/** The scene's hour moved on: how busy (`factor`, 1 = the day's average
 *  hour) and how far the light has run since the start (m). */
export function setTrafficClock(factor: number, travel: number): void {
  trafficNow.value = factor;
  trafficTravel.value = travel;
}

/** The body's size against its daily one, with the hour: the root of the
 *  traffic (like its build), from a third at night to half again at the
 *  peak. */
const GROW = { min: 0.35, max: 1.5 } as const;

/** The colour of a lane carrying `dtv` vehicles a day at the hour's rate
 *  (`TRAFFIC_SCALE`, log-spaced between its stops), and its place on the
 *  scale 0..1. */
function liveRamp(dtv: F): { load: F; tint: V3 } {
  const logd = log(dtv.mul(trafficNow).max(1));
  let tint = color(TRAFFIC_SCALE[0].tint) as unknown as V3;
  let load = float(0) as F;
  const span = TRAFFIC_SCALE.length - 1;
  for (let i = 0; i < span; i++) {
    const lo = Math.log(TRAFFIC_SCALE[i].dtv);
    const hi = Math.log(TRAFFIC_SCALE[i + 1].dtv);
    const seg = logd
      .sub(lo)
      .div(hi - lo)
      .clamp(0, 1);
    tint = mix(tint, color(TRAFFIC_SCALE[i + 1].tint), seg);
    load = load.add(seg.div(span));
  }
  return { load, tint };
}

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

function trafficMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("traffic-glass", () => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    // Packed (`TRAFFIC_ATTRIBUTES`): WebGPU draws from at most eight
    // vertex buffers, and every attribute is one.
    const lane = attribute("trafficLane", "vec4") as V4;
    const count = attribute("trafficCount", "vec3") as V3;
    const along = lane.x;
    const rise = lane.y;
    const flows = lane.w;
    const daily = count.x;
    const dtv = count.y;
    const heavy = count.z;
    m.positionNode = trafficPositionNode();
    const ramp = liveRamp(dtv);
    const tint = mix(
      ramp.tint,
      color(TRAFFIC_HEAVY_TINT),
      heavy.mul(4).clamp(0, 0.6)
    ) as V3;
    const glass = glassColour({
      tint,
      density: ramp.load.mul(0.3).add(0.22),
      rim: 0.8,
    });
    // The light: comets running with the traffic, spaced by the street's
    // daily load (the period shrinks to a third on the busiest) — so the
    // spacing never jumps as the hour moves on — and as many of them lit
    // as the hour has traffic: one in eight at night, all from the
    // average hour on. Brightest along the crown, fading toward the feet;
    // a still glow where nothing flows.
    const period = float(PULSE_PERIOD_M).div(daily.mul(2).add(1));
    const cell = along.sub(trafficTravel.mul(flows)).div(period);
    const phase = fract(cell);
    const lit = step(
      hash(floor(cell).add(dtv.mul(0.0137))),
      trafficNow.mul(0.9).clamp(0.12, 1)
    );
    const comet = smoothstep(0, 0.08, phase)
      .mul(float(1).sub(smoothstep(0.08, 0.55, phase)))
      .mul(lit);
    const pulse = mix(float(0.35), comet, flows);
    const core = smoothstep(0.15, 0.9, rise).mul(
      float(1).sub(glassGrazing().mul(0.7))
    );
    const light = mix(tint, vec3(1), 0.35).mul(
      pulse.mul(core).mul(ramp.load.mul(0.45).add(0.2))
    );
    m.colorNode = glass.add(light);
    return m;
  });
}

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

interface Body {
  across: number[];
  count: number[];
  index: number[];
  lane: number[];
  pos: number[];
  /** each vertex's section: its index in the tile's traffic file */
  section: number[];
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
  section: number,
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
      const up = v * height * size;
      body.pos.push(w.x, ground - FOOT_SINK_M + up, w.z);
      // the same offset in the world frame (z = −y)
      body.across.push(right[0] * r, 0, -right[1] * r);
      body.lane.push(at, v, up, lane.flows ? 1 : 0);
      body.count.push(lane.load, lane.dtv, lane.heavy);
      body.section.push(section);
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
    count: [],
    index: [],
    lane: [],
    pos: [],
    section: [],
  };
  const needsDecks = features.some((f) => f.properties?.br === 1);
  const decks = needsDecks ? buildDeckTable(bridges, ctx) : [];
  const open = openEnds(features, bounds);
  for (const [i, f] of features.entries()) {
    const onBridge = f.properties?.br === 1;
    for (const lane of trafficLanes(f, open[i])) {
      addLane(body, i, lane, onBridge, decks, ctx, detail);
    }
  }
  if (body.index.length === 0) {
    return group;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(body.pos, 3));
  geo.setAttribute("trafficAcross", new Float32BufferAttribute(body.across, 3));
  geo.setAttribute("trafficLane", new Float32BufferAttribute(body.lane, 4));
  geo.setAttribute("trafficCount", new Float32BufferAttribute(body.count, 3));
  geo.setIndex(body.index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // From the air the bodies widen up to MAP_WIDEN.max ×, and at the peak
  // they grow by GROW.max: the sphere must hold them then too, or a
  // street at the frame's edge culls out.
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
  // Which section each vertex belongs to, for the probe (traffic-ask.ts):
  // CPU-side only — a vertex attribute would be a ninth buffer.
  mesh.userData.trafficSection = Uint32Array.from(body.section);
  group.add(mesh);
  return group;
}
