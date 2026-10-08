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
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { Instances, instancePosition } from "./instancing";
import type { Pt } from "./rail-layer";
import type { F, Live } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";
import { addWire, wireMesh, wires, type Wires } from "./wire-ribbons";

/** Lamp post height (m). OSM rarely tags it; the bake defaults each lamp to 5 m. */
const LAMP_H = 5;
/** A lamp hung across the street (pipeline/bake/lamps.py `HUNG_H`): its
 *  head over the ground, the wire's ends that much higher on the facades
 *  or masts, so it sags down to the lamp. */
const HUNG_H = 7;
const WIRE_END_LIFT = 0.6;
const WIRE_HALF = 0.008;
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
/** Fixed pool of real point lights: allocated ONCE so NUM_POINT_LIGHTS never
 * changes (a count change recompiles every lit material — a visible hitch). */
const MAX_REAL_LAMPS = 3;
/** Real-light reach: bright within NEAR, faded to 0 by FAR so the nearest-N
 * hand-off (as the player walks) happens while a light is already dim — no pop. */
const LIGHT_NEAR = 14;
const LIGHT_FAR = 42;
const LIGHT_BASE = 14;
const LIGHT_RANGE = 40;

interface Place {
  x: number;
  y: number;
  z: number;
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
  places: Place[],
  scale = 1
): Instances {
  const mesh = new Instances(geo, material, places.length);
  const m = new Matrix4();
  for (let i = 0; i < places.length; i++) {
    m.makeScale(scale, scale, scale).setPosition(
      places[i].x,
      places[i].y,
      places[i].z
    );
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

/** Tapered pole topped by a small dark housing — a normal lit mesh (~12 tris). */
function buildPosts(places: Place[]): Instances {
  const pole = new CylinderGeometry(0.06, 0.1, LAMP_H, 6);
  pole.translate(0, LAMP_H / 2, 0);
  const housing = new BoxGeometry(0.32, 0.22, 0.32);
  housing.translate(0, LAMP_H, 0);
  const geo = mergeGeometries([pole, housing]) ?? pole;
  const mesh = placeInstances(geo, postMaterial(), places);
  mesh.name = "lamp-posts";
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

/** Flat additive disc on the pavement — the "pool" that sells night. */
function buildDecals(places: Place[]): Instances {
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
  const decals = places.map((p) => ({ x: p.x, y: p.y + 0.05, z: p.z }));
  const mesh = placeInstances(geo, mat, decals);
  mesh.name = "lamp-pools";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  return mesh;
}

/** A tile's lamps sorted by how they are held. */
interface LampPlaces {
  /** every head, posts' and hung lamps', for the halos and the real lights */
  heads: Vector3[];
  hung: Place[];
  masts: Place[];
  /** every lamp's ground, for the light pools */
  pools: Place[];
  posts: Place[];
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

function lampPlaces(features: LampFeature[], ctx: GroundContext): LampPlaces {
  const out: LampPlaces = {
    heads: [],
    hung: [],
    masts: [],
    pools: [],
    posts: [],
    wires: wires(),
  };
  for (const f of features) {
    if (f.geometry?.type !== "Point") {
      continue;
    }
    const ground = liftedPt(f.geometry.coordinates, 0, ctx);
    if (!ground) {
      continue; // off-tile / NoData
    }
    const hung = Boolean(f.properties?.wire);
    const h = hung ? HUNG_H : LAMP_H;
    (hung ? out.hung : out.posts).push(ground);
    out.pools.push(ground);
    out.heads.push(new Vector3(ground.x, ground.y + h, ground.z));
    if (hung) {
      hangWire(f, { x: ground.x, y: ground.y + h, z: ground.z }, ctx, out);
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
 * a post with its head, or — a lamp hung across the street — a head on a
 * wire between the facades (or masts at the kerb). Mostly fake — emissive
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

  if (places.posts.length > 0) {
    group.add(buildPosts(places.posts), taggedHeads(places.posts, LAMP_H));
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

// Pre-allocated scratch for nearestThree; read synchronously within the same
// frame by updateNearest, so a shared mutable buffer is safe and allocation-free.
const nearIdx = [-1, -1, -1];
const nearDist = [
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY,
];

/** Picks the indices of the up-to-three heads nearest the camera (one pass). */
function nearestThree(heads: Vector3[], camPos: Vector3): number[] {
  const idx = nearIdx;
  const dist = nearDist;
  idx[0] = -1;
  idx[1] = -1;
  idx[2] = -1;
  dist[0] = Number.POSITIVE_INFINITY;
  dist[1] = Number.POSITIVE_INFINITY;
  dist[2] = Number.POSITIVE_INFINITY;
  for (let i = 0; i < heads.length; i++) {
    const d = heads[i].distanceToSquared(camPos);
    if (d < dist[0]) {
      dist[2] = dist[1];
      idx[2] = idx[1];
      dist[1] = dist[0];
      idx[1] = idx[0];
      dist[0] = d;
      idx[0] = i;
    } else if (d < dist[1]) {
      dist[2] = dist[1];
      idx[2] = idx[1];
      dist[1] = d;
      idx[1] = i;
    } else if (d < dist[2]) {
      dist[2] = d;
      idx[2] = i;
    }
  }
  return idx;
}

/** smoothstep(edge0, edge1, x) → 1 near edge0, 0 by edge1 (clamped). */
function falloff(d: number): number {
  const t = Math.min(
    Math.max((d - LIGHT_NEAR) / (LIGHT_FAR - LIGHT_NEAR), 0),
    1
  );
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A small fixed pool of real point lights shared by ALL tiles' lamps. Allocated
 * ONCE before the first frame (so `NUM_POINT_LIGHTS` is constant — no
 * recompile churn), never added or removed; at midday, and until the first
 * tile's lamps have streamed in (`setHeads`), they simply sit at intensity 0.
 * Each frame they jump to the nearest lamp heads with a distance falloff so
 * the hand-off is invisible.
 */
export function createLampLights(initialHeads: Vector3[] = []): LampLights {
  let heads = initialHeads;
  const lights: PointLight[] = [];
  for (let i = 0; i < MAX_REAL_LAMPS; i++) {
    const light = new PointLight(0xff_d0_89, 0, LIGHT_RANGE, 2);
    light.castShadow = false;
    lights.push(light);
  }
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
      const idx = nearestThree(heads, camPos);
      for (let s = 0; s < lights.length; s++) {
        const head = idx[s] >= 0 ? heads[idx[s]] : null;
        if (!head) {
          lights[s].intensity = 0;
          continue;
        }
        lights[s].position.copy(head);
        lights[s].intensity =
          nightFactor * LIGHT_BASE * falloff(head.distanceTo(camPos));
      }
    },
    dispose: () => {
      for (const light of lights) {
        light.dispose();
      }
    },
  };
}
