import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  PointLight,
  PointsNodeMaterial,
  Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { color, float, mix, select, uniform, uv, vec3, vec4 } from "three/tsl";
import type { LampFeature } from "@/lib/city/features";
import { yawOfBearing } from "@/lib/city/furniture";
import {
  ARM_DROP,
  armOffset,
  armReach,
  LAMP_POST_H,
  postHeight,
} from "@/lib/city/lamps";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { Instances, instancePosition } from "./instancing";
import type { Pt } from "./rail-layer";
import type { DeviceTier } from "./scene-profile";
import type { F, Live } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";
import { addWire, wireMesh, wires, type Wires } from "./wire-ribbons";

/** A post's height (m) where the bake measured none. */
const LAMP_H = LAMP_POST_H;
/** A lamp hung across the street (pipeline/bake/lamps.py `HUNG_H`): its
 *  head over the ground, the wire's ends that much higher on the facades
 *  or masts, so it sags down to the lamp. */
const HUNG_H = 7;
const WIRE_END_LIFT = 0.6;
const WIRE_HALF = 0.008;
/** A wall lantern's bracket: thicker than a wire, rising to the facade. */
const BRACKET_HALF = 0.025;
const BRACKET_RISE = 0.25;
/** The lamp wires in the posts' dark metal, so the head reads as hung. */
const LAMP_WIRE_INK = { color: 0x3a_3a_40, opacity: 0.9 };
/** A mast at the kerb holding a wire end where no facade stands. */
const MAST_R = 0.07;
/** Emissive lantern intensity at full night. */
const HEAD_EMISSIVE = 3;
/** Additive glow-sprite world size + peak opacity. */
const GLOW_SIZE = 7;
const GLOW_OPACITY = 0.55;
/** Ground light-pool radius (m) + peak opacity. */
const POOL_R = 6;
const POOL_OPACITY = 0.5;
/**
 * A device tier's real lamp lights: how many (`lights`), and the band (m)
 * over which the last of them hands over to the next head (`handOverM`,
 * 0: none). The pool is allocated ONCE, before the first frame, so the
 * light count never changes (three hashes every light into every lit node
 * build: a count change rebuilds every lit material — a visible hitch).
 */
export interface LampLightBudget {
  handOverM: number;
  lights: number;
}

/**
 * Real lamp lights per device tier. Every lit fragment shades each of them,
 * by day too (at intensity 0), so a phone lights only the nearest head.
 * Three hand over at the third-nearest head, which the distance falloff has
 * mostly dimmed; a lone light hands over at the nearest — on the bisector
 * between two lamps, ~15 m from each at street spacing, where the falloff
 * is still ~1 — so it fades through zero across the hand-off instead of
 * jumping from one lamp to the next at full strength.
 */
export const LAMP_LIGHTS: Readonly<Record<DeviceTier, LampLightBudget>> = {
  desktop: { lights: 3, handOverM: 0 },
  mobile: { lights: 1, handOverM: 6 },
};
/** Real-light reach: bright within NEAR, faded to 0 by FAR, so a hand-off
 * at a far head (the third of three) happens while its light is dim. */
const LIGHT_NEAR = 14;
const LIGHT_FAR = 42;
const LIGHT_BASE = 14;
const LIGHT_RANGE = 40;

interface Place {
  x: number;
  y: number;
  z: number;
}

/** A lamp's ground, with the scale of its light pool. */
interface Pool extends Place {
  s: number;
}

/** A mast's arm: its post's foot, turned to the bearing it reaches to. */
interface ArmPlace extends Place {
  yaw: number;
}

/** Per-tile lamp visuals (posts + heads + glow + ground pools) on the Y-up scene. */
export interface LampControl {
  /** Nothing of the tile's own to free: the meshes go with the scene and
   *  the materials (and their procedural glow) are scene-wide. */
  dispose: () => void;
  group: Group;
  /** world-space (Y-up) lantern-head positions, fed to the shared light pool */
  headPositions: Vector3[];
  /** 0 (day, inert grey) → 1 (night, ignited): emissive + glow + pool opacity */
  setNightFactor: (t: number) => void;
}

/** A small fixed pool of real point lights shared across ALL tiles' lamps. */
export interface LampLights {
  dispose: () => void;
  lights: PointLight[];
  /** replaces the lamp heads the pool retargets to (tiles stream in) */
  setHeads: (heads: Vector3[]) => void;
  setNightFactor: (t: number) => void;
  /** repositions the lights onto the nearest lamp heads (call per frame) */
  updateNearest: (camPos: Vector3) => void;
}

/** The lamps' warm light (the heads' emissive, halos, pools, real lights). */
const LAMP_LIGHT = 0xff_d0_89;

/**
 * The one night factor every tile's lamps read (0 by day → 1 at night): a
 * uniform node, so a tile's `setNightFactor` is a uniform write — every
 * tile is driven with the same value, and one that streams in later is
 * born with it. The materials are then the scene's (`sceneMaterial`), one
 * node build for every tile.
 */
export const lampNight: Live = uniform(0);

/**
 * The soft radial alpha of the halos and pools, from the quad's (or disc's)
 * uv: 1 at the centre, 0.4 halfway out, 0 at the rim and past it — the
 * stops of the 64² canvas gradient this used to be, interpolated linearly
 * as the canvas did. Radially symmetric, so no uv flip can turn it.
 */
function glowAlpha(): F {
  const r = uv().sub(0.5).length().mul(2);
  return select(
    r.lessThan(0.5),
    mix(float(1), float(0.4), r.mul(2)),
    mix(float(0.4), float(0), r.sub(0.5).mul(2).clamp(0, 1))
  );
}

function placeInstances(
  geo: BufferGeometry,
  material: Material,
  places: readonly (Place & { s?: number; yaw?: number })[],
  scale = 1
): Instances {
  const mesh = new Instances(geo, material, places.length);
  const m = new Matrix4();
  const turn = new Matrix4();
  for (let i = 0; i < places.length; i++) {
    const s = scale * (places[i].s ?? 1);
    m.makeScale(s, s, s);
    const yaw = places[i].yaw;
    if (yaw !== undefined) {
      m.premultiply(turn.makeRotationY(yaw));
    }
    m.setPosition(places[i].x, places[i].y, places[i].z);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Spread-out cloud: recompute the sphere or it culls when the origin is off-screen.
  mesh.computeBoundingSphere();
  return mesh;
}

const postMaterial = (): Material =>
  sceneMaterial("lamp-post", () => {
    const m = new MeshStandardNodeMaterial({
      color: 0x3a_3a_40,
      roughness: 0.7,
      metalness: 0.2,
    });
    m.positionNode = instancePosition();
    return m;
  });

/** Tapered pole of `height` topped by a small dark housing — a normal lit
 *  mesh (~12 tris). */
function buildPosts(places: Place[], height: number): Instances {
  const pole = new CylinderGeometry(0.06, 0.1, height, 6);
  pole.translate(0, height / 2, 0);
  const housing = new BoxGeometry(0.32, 0.22, 0.32);
  housing.translate(0, height, 0);
  const geo = mergeGeometries([pole, housing]) ?? pole;
  const mesh = placeInstances(geo, postMaterial(), places);
  mesh.name = "lamp-posts";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A tall mast's pole, up to where its arm leaves it (`buildArms`): the
 *  posts' material, a little stouter. */
function buildPoles(places: Place[], height: number): Instances {
  const h = height - ARM_DROP + 0.1;
  const pole = new CylinderGeometry(0.07, 0.12, h, 6);
  pole.translate(0, h / 2, 0);
  const mesh = placeInstances(pole, postMaterial(), places);
  mesh.name = "lamp-poles";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A mast's arm, out of its pole `ARM_DROP` under the head and rising to it
 *  over local +Z (`armReach`), the luminaire's flat cap over the head; each
 *  turned to its bearing. */
function buildArms(places: ArmPlace[], height: number): Instances {
  const reach = armReach(height);
  const tube = new CylinderGeometry(
    0.035,
    0.05,
    Math.hypot(reach, ARM_DROP),
    5
  );
  tube.rotateX(Math.atan2(reach, ARM_DROP)); // its +Y along the arm
  tube.translate(0, height - ARM_DROP / 2, reach / 2);
  const cap = new BoxGeometry(0.34, 0.08, 0.5);
  cap.translate(0, height + 0.19, reach);
  const geo = mergeGeometries([tube, cap]) ?? tube;
  const mesh = placeInstances(geo, postMaterial(), places);
  mesh.name = "lamp-arms";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Slim masts at the kerb holding a hung lamp's wire, the posts' material. */
function buildMasts(places: Place[]): Instances {
  const h = HUNG_H + WIRE_END_LIFT + 0.2;
  const geo = new CylinderGeometry(MAST_R * 0.7, MAST_R, h, 6);
  geo.translate(0, h / 2, 0);
  const mesh = placeInstances(geo, postMaterial(), places);
  mesh.name = "lamp-masts";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Emissive lantern head at `height`; the emissive rides the night factor
 *  (0 by day). */
function buildHeads(places: Place[], height = LAMP_H): Instances {
  const geo = new BoxGeometry(0.3, 0.3, 0.3);
  geo.translate(0, height, 0);
  const mat = sceneMaterial("lamp-head", () => {
    const m = new MeshStandardNodeMaterial({
      color: 0x33_33_2e,
      roughness: 0.6,
    });
    m.positionNode = instancePosition();
    m.emissiveNode = color(LAMP_LIGHT).mul(lampNight.mul(HEAD_EMISSIVE));
    return m;
  });
  const mesh = placeInstances(geo, mat, places);
  mesh.name = "lamp-heads";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Additive billboard halos at each head, one draw call: a unit quad per
 * head under a `PointsNodeMaterial`, which on a mesh (not `Points`) draws
 * each vertex's quad corner as a screen-space offset of `size` pixels,
 * attenuated by depth as the old point sprites were (`size × half the
 * canvas height / depth`). A real `Points` cloud will not do: WebGPU
 * draws point primitives one pixel wide whatever their size. The instance
 * matrix carries the head's position (the quad's centre, `positionNode`)
 * and a scale of the halo's size, which only widens the set's bounding
 * sphere so a halo whose head is just off-screen is not culled.
 */
function buildGlow(heads: Vector3[]): Instances {
  const geo = new PlaneGeometry(1, 1);
  geo.deleteAttribute("normal");
  const mat = sceneMaterial("lamp-glow", () => {
    const m = new PointsNodeMaterial({
      color: LAMP_LIGHT,
      size: GLOW_SIZE,
      sizeAttenuation: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    m.positionNode = instancePosition(vec3(0));
    m.colorNode = vec4(color(LAMP_LIGHT), glowAlpha());
    m.opacityNode = lampNight.mul(GLOW_OPACITY);
    return m;
  });
  const mesh = placeInstances(geo, mat, heads, GLOW_SIZE);
  mesh.name = "lamp-glow";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  return mesh;
}

/** Flat additive disc on the pavement — the "pool" that sells night,
 *  `POOL_R` wide under a post of `LAMP_H`, in proportion under another. */
function buildDecals(places: Pool[]): Instances {
  const geo = new CircleGeometry(POOL_R, 24);
  geo.rotateX(-Math.PI / 2); // face up (XZ plane)
  const mat = sceneMaterial("lamp-pool", () => {
    const m = new MeshBasicNodeMaterial({
      color: LAMP_LIGHT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      // Lift + offset so the disc doesn't z-fight the (sloped) street.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    m.positionNode = instancePosition();
    m.opacityNode = lampNight.mul(POOL_OPACITY).mul(glowAlpha());
    return m;
  });
  const decals = places.map((p) => ({ ...p, y: p.y + 0.05 }));
  const mesh = placeInstances(geo, mat, decals);
  mesh.name = "lamp-pools";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  return mesh;
}

/** A tile's lamps sorted by how they are held. */
interface LampPlaces {
  /** the tall masts' arms by their height (m) */
  arms: Map<number, ArmPlace[]>;
  /** every head, posts' and hung lamps', for the halos and the real lights */
  heads: Vector3[];
  hung: Place[];
  masts: Place[];
  /** the tall masts' poles by their height (m): their heads are on arms */
  poles: Map<number, Place[]>;
  /** the ground under every head, for the light pools */
  pools: Pool[];
  /** the posts with their head on top, by their height (m) */
  posts: Map<number, Place[]>;
  /** the heads with no post under them by their height (m): the wall
   *  lanterns on their brackets, the heads at the masts' arm ends */
  walls: Map<number, Place[]>;
  wires: Wires;
}

/** A point at `lift` m over the ground at EPSG (x, y), or null off it. */
function liftedPt(
  [ex, ey]: readonly [number, number],
  lift: number,
  ctx: GroundContext
): Pt | null {
  const ground = ctx.heightAt(ex, ey);
  if (ground === null) {
    return null;
  }
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
  return { x, y: ground + lift, z };
}

/** A lamp's foot: on its bridge's deck (`deck`, the deck's top in m —
 *  pipeline/bake/lamps.py) or on the ground; null off the tile. */
function footOf(f: LampFeature, ctx: GroundContext): Pt | null {
  const deck = f.properties?.deck;
  if (deck === undefined) {
    return liftedPt(f.geometry.coordinates, 0, ctx);
  }
  const [ex, ey] = f.geometry.coordinates;
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
  return { x, y: deck, z };
}

/** A hung lamp's wire, from each end (a facade or a mast, higher) down to
 *  the top of its head, and the masts it needs. */
function hangWire(
  f: LampFeature,
  head: Pt,
  ctx: GroundContext,
  out: LampPlaces
): void {
  const wire = f.properties?.wire;
  if (!wire) {
    return;
  }
  const top = { x: head.x, y: head.y + 0.15, z: head.z };
  wire.forEach((end, i) => {
    const at = liftedPt(end, HUNG_H + WIRE_END_LIFT, ctx);
    if (!at) {
      return;
    }
    addWire(out.wires, [at, top], WIRE_HALF);
    if (f.properties?.masts?.[i]) {
      out.masts.push({ x: at.x, y: at.y - HUNG_H - WIRE_END_LIFT, z: at.z });
    }
  });
}

/** A wall lantern's bracket, from its facade (`wall`, a little higher) out
 *  to the top of its head. */
function bracket(
  f: LampFeature,
  head: Pt,
  ctx: GroundContext,
  out: LampPlaces
): void {
  const wall = f.properties?.wall;
  if (!wall) {
    return;
  }
  const { x, z } = epsgToWorld(wall[0], wall[1], ctx.offset);
  const top = { x: head.x, y: head.y + 0.15, z: head.z };
  addWire(out.wires, [{ x, y: head.y + BRACKET_RISE, z }, top], BRACKET_HALF);
}

function byHeight<T extends Place>(
  sets: Map<number, T[]>,
  h: number,
  at: T
): void {
  const set = sets.get(h);
  if (set) {
    set.push(at);
  } else {
    sets.set(h, [at]);
  }
}

/** A light pool's scale under a head `h` m up: a taller post lights a wider
 *  pool. */
const poolScale = (h: number) => Math.min(Math.max(h / LAMP_H, 0.8), 2);

/**
 * A tall mast: its pole at its foot, its arm to its bearing (`arm`), the
 * head at the arm's end `h` m over the foot, and the light pool on the
 * ground (or the deck) under that head.
 */
function placeMast(
  f: LampFeature,
  [dx, dy]: [number, number],
  foot: Pt,
  ctx: GroundContext,
  out: LampPlaces
): void {
  const h = postHeight(f);
  byHeight(out.poles, h, foot);
  byHeight(out.arms, h, { ...foot, yaw: yawOfBearing(f.properties?.arm ?? 0) });
  // north is world −Z
  const end = { x: foot.x + dx, y: foot.y, z: foot.z - dy };
  byHeight(out.walls, h, end);
  out.heads.push(new Vector3(end.x, end.y + h, end.z));
  // on a bridge, its deck; else the ground under the head
  const [ex, ey] = f.geometry.coordinates;
  const below = f.properties?.deck ?? ctx.heightAt(ex + dx, ey + dy) ?? foot.y;
  out.pools.push({ ...end, y: below, s: poolScale(h) });
}

function placeLamp(f: LampFeature, ctx: GroundContext, out: LampPlaces): void {
  const ground = footOf(f, ctx);
  if (!ground) {
    return; // off-tile / NoData
  }
  const arm = armOffset(f);
  if (arm) {
    placeMast(f, arm, ground, ctx, out);
    return;
  }
  const hung = Boolean(f.properties?.wire);
  const onWall = !hung && f.properties?.wall !== undefined;
  const h = hung ? HUNG_H : postHeight(f);
  if (hung) {
    out.hung.push(ground);
  } else {
    byHeight(onWall ? out.walls : out.posts, h, ground);
  }
  // a taller post lights a wider pool; a hung lamp's is the one it had
  const s = hung ? 1 : poolScale(h);
  out.pools.push({ ...ground, s });
  out.heads.push(new Vector3(ground.x, ground.y + h, ground.z));
  const head = { x: ground.x, y: ground.y + h, z: ground.z };
  if (hung) {
    hangWire(f, head, ctx, out);
  } else if (onWall) {
    bracket(f, head, ctx, out);
  }
}

function lampPlaces(features: LampFeature[], ctx: GroundContext): LampPlaces {
  const out: LampPlaces = {
    arms: new Map(),
    heads: [],
    hung: [],
    masts: [],
    poles: new Map(),
    pools: [],
    posts: new Map(),
    walls: new Map(),
    wires: wires(),
  };
  for (const f of features) {
    if (f.geometry?.type === "Point") {
      placeLamp(f, ctx, out);
    }
  }
  return out;
}

/** Heads at one height, tagged for the picture styles' light cones
 *  (style-dressing.ts) with that height; the layer itself knows no style. */
function taggedHeads(places: Place[], height: number): Instances {
  const heads = buildHeads(places, height);
  heads.userData.styleLampHeads = { height };
  return heads;
}

/**
 * Builds one tile's OSM street lamps into stylized geometry on the Y-up scene:
 * a post with its head, a tall mast with its head on an arm over the
 * carriageway, a lantern on its bracket out of a facade or a wall, or — a
 * lamp hung across the street — a head on a wire between the facades (or
 * masts at the kerb). Mostly fake — emissive
 * heads, additive glow sprites and ground light-pool decals — driven by a
 * single `nightFactor`; the real lighting comes from a small shared
 * {@link createLampLights} pool. An empty feature list yields an empty group.
 */
export function buildLamps(
  features: LampFeature[],
  ctx: GroundContext
): LampControl {
  const group = new Group();
  group.name = "lamps";
  const places = lampPlaces(features, ctx);
  const headPositions = places.heads;

  if (places.pools.length === 0) {
    return {
      group,
      headPositions,
      setNightFactor: () => {
        // nothing to drive
      },
      dispose: () => {
        // empty
      },
    };
  }

  for (const [height, posts] of places.posts) {
    group.add(buildPosts(posts, height), taggedHeads(posts, height));
  }
  for (const [height, poles] of places.poles) {
    group.add(buildPoles(poles, height));
  }
  for (const [height, arms] of places.arms) {
    group.add(buildArms(arms, height));
  }
  for (const [height, lanterns] of places.walls) {
    group.add(taggedHeads(lanterns, height));
  }
  if (places.hung.length > 0) {
    group.add(taggedHeads(places.hung, HUNG_H));
  }
  if (places.masts.length > 0) {
    group.add(buildMasts(places.masts));
  }
  const wireSet = wireMesh(places.wires, "lamp-wires", LAMP_WIRE_INK);
  if (wireSet) {
    group.add(wireSet);
  }
  const glow = buildGlow(headPositions);
  const decals = buildDecals(places.pools);
  group.add(glow, decals);

  return {
    group,
    headPositions,
    setNightFactor: (t) => {
      const nf = Math.min(Math.max(t, 0), 1);
      // One value for every tile: the heads' emissive, the halos' and the
      // pools' opacity all read it. Visibility stays per tile, so by day
      // the additive passes are skipped outright.
      lampNight.value = nf;
      glow.visible = nf > 0.01;
      decals.visible = nf > 0.01;
    },
    // disposeObject3D frees the meshes with the scene; nothing else is the
    // tile's.
    dispose: () => {
      // nothing of its own
    },
  };
}

/**
 * Fills `idx` with the indices of the `idx.length` heads nearest `from`,
 * nearest first, and `dist` with their squared distances (−1 and +∞ past
 * the last head). One pass, no allocation; of two heads at the same
 * distance the earlier keeps the nearer slot.
 */
function nearestHeads(
  heads: readonly Vector3[],
  from: Vector3,
  idx: number[],
  dist: number[]
): void {
  const n = idx.length;
  idx.fill(-1);
  dist.fill(Number.POSITIVE_INFINITY);
  if (n === 0) {
    return;
  }
  for (let i = 0; i < heads.length; i++) {
    const d = heads[i].distanceToSquared(from);
    if (!(d < dist[n - 1])) {
      continue;
    }
    let s = n - 1;
    while (s > 0 && d < dist[s - 1]) {
      idx[s] = idx[s - 1];
      dist[s] = dist[s - 1];
      s--;
    }
    idx[s] = i;
    dist[s] = d;
  }
}

/** smoothstep(edge0, edge1, x) → 1 near edge0, 0 by edge1 (clamped). */
function falloff(d: number): number {
  const t = Math.min(
    Math.max((d - LIGHT_NEAR) / (LIGHT_FAR - LIGHT_NEAR), 0),
    1
  );
  return 1 - t * t * (3 - 2 * t);
}

/** 0 where the next head is as near as the light's own (squared distances
 *  `near`, `next`), 1 once it is `band` m farther (smoothstep); 1 without a
 *  band or a next head. */
function handOver(near: number, next: number, band: number): number {
  if (band <= 0) {
    return 1;
  }
  const lead = Math.sqrt(next) - Math.sqrt(near);
  const t = Math.min(Math.max(lead / band, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The pool of real point lights shared by ALL tiles' lamps, `budget.lights`
 * of them (`LAMP_LIGHTS`, per device tier). Allocated ONCE before the first
 * frame (so the light count is constant — no rebuild churn), never added
 * or removed; at midday, and until the first tile's lamps have streamed in
 * (`setHeads`), they simply sit at intensity 0. Each frame they jump to the
 * nearest lamp heads with a distance falloff, the last of them faded over
 * its hand-off band (`budget.handOverM`), so the hand-off is not seen.
 */
export function createLampLights(budget: LampLightBudget): LampLights {
  let heads: Vector3[] = [];
  const lights: PointLight[] = [];
  for (let i = 0; i < budget.lights; i++) {
    const light = new PointLight(LAMP_LIGHT, 0, LIGHT_RANGE, 2);
    light.castShadow = false;
    lights.push(light);
  }
  // The nearest heads, one more than the lights where the last one hands
  // over (its lead over the next decides its fade); read within the frame.
  const ranked = budget.lights + (budget.handOverM > 0 ? 1 : 0);
  const idx = Array.from({ length: ranked }, () => -1);
  const dist = Array.from({ length: ranked }, () => Number.POSITIVE_INFINITY);
  const last = lights.length - 1;
  let nightFactor = 0;

  return {
    lights,
    setHeads: (next) => {
      heads = next;
    },
    setNightFactor: (t) => {
      nightFactor = Math.min(Math.max(t, 0), 1);
    },
    updateNearest: (camPos) => {
      if (heads.length === 0 || nightFactor <= 0.001) {
        for (const light of lights) {
          light.intensity = 0;
        }
        return;
      }
      nearestHeads(heads, camPos, idx, dist);
      for (let s = 0; s < lights.length; s++) {
        if (idx[s] < 0) {
          lights[s].intensity = 0;
          continue;
        }
        const fade =
          s === last ? handOver(dist[s], dist[s + 1], budget.handOverM) : 1;
        lights[s].position.copy(heads[idx[s]]);
        lights[s].intensity =
          nightFactor * LIGHT_BASE * falloff(Math.sqrt(dist[s])) * fade;
      }
    },
    dispose: () => {
      for (const light of lights) {
        light.dispose();
      }
    },
  };
}
