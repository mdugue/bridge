import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Points,
  PointsMaterial,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { epsgToWorld } from "@/lib/city/ground-clamp";
import { fetchFeatures, type VegetationContext } from "./vegetation-layer";

/** Lamp post height (m). OSM rarely tags it; the bake defaults each lamp to 5 m. */
const LAMP_H = 5;
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

interface LampPoint {
  geometry: { coordinates: [number, number]; type: "Point" };
  properties: { h?: number };
}

interface Place {
  x: number;
  y: number;
  z: number;
}

/** Per-tile lamp visuals (posts + heads + glow + ground pools) on the Y-up scene. */
export interface LampControl {
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
  setNightFactor: (t: number) => void;
  /** repositions the lights onto the nearest lamp heads (call per frame) */
  updateNearest: (camPos: Vector3) => void;
}

/** A 64² soft radial-alpha disc, shared by the glow sprites and ground pools. */
function makeGlowSprite(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.4)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

function placeInstances(mesh: InstancedMesh, places: Place[]): void {
  const dummy = new Object3D();
  for (let i = 0; i < places.length; i++) {
    dummy.position.set(places[i].x, places[i].y, places[i].z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Spread-out cloud: recompute the sphere or it culls when the origin is off-screen.
  mesh.computeBoundingSphere();
}

/** Tapered pole topped by a small dark housing — a normal lit mesh (~12 tris). */
function buildPosts(places: Place[]): InstancedMesh {
  const pole = new CylinderGeometry(0.06, 0.1, LAMP_H, 6);
  pole.translate(0, LAMP_H / 2, 0);
  const housing = new BoxGeometry(0.32, 0.22, 0.32);
  housing.translate(0, LAMP_H, 0);
  const geo = mergeGeometries([pole, housing]) ?? pole;
  const mat = new MeshStandardMaterial({
    color: 0x3a_3a_40,
    roughness: 0.7,
    metalness: 0.2,
  });
  const mesh = new InstancedMesh(geo, mat, places.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  placeInstances(mesh, places);
  return mesh;
}

/** Emissive lantern head; emissiveIntensity rides nightFactor (0 by day). */
function buildHeads(places: Place[]): InstancedMesh {
  const geo = new BoxGeometry(0.3, 0.3, 0.3);
  geo.translate(0, LAMP_H, 0);
  const mat = new MeshStandardMaterial({
    color: 0x33_33_2e,
    roughness: 0.6,
    emissive: 0xff_d0_89,
    emissiveIntensity: 0,
  });
  const mesh = new InstancedMesh(geo, mat, places.length);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  placeInstances(mesh, places);
  return mesh;
}

/** Additive billboard halos at each head — a Points cloud (one draw call). */
function buildGlow(heads: Vector3[], sprite: CanvasTexture): Points {
  const positions = new Float32Array(heads.length * 3);
  for (let i = 0; i < heads.length; i++) {
    positions[i * 3] = heads[i].x;
    positions[i * 3 + 1] = heads[i].y;
    positions[i * 3 + 2] = heads[i].z;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.computeBoundingSphere();
  const mat = new PointsMaterial({
    map: sprite,
    size: GLOW_SIZE,
    sizeAttenuation: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    color: 0xff_d0_89,
    opacity: 0,
  });
  const points = new Points(geo, mat);
  points.name = "lamp-glow";
  points.visible = false;
  return points;
}

/** Flat additive disc on the pavement — the "pool" that sells night. */
function buildDecals(places: Place[], sprite: CanvasTexture): InstancedMesh {
  const geo = new CircleGeometry(POOL_R, 24);
  geo.rotateX(-Math.PI / 2); // face up (XZ plane)
  const mat = new MeshBasicMaterial({
    map: sprite,
    color: 0xff_d0_89,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    opacity: 0,
    // Lift + offset so the disc doesn't z-fight the (sloped) street.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const decals = places.map((p) => ({ x: p.x, y: p.y + 0.05, z: p.z }));
  const mesh = new InstancedMesh(geo, mat, decals.length);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  placeInstances(mesh, decals);
  return mesh;
}

/**
 * Loads OSM street lamps for one tile into stylized geometry on the Y-up scene.
 * Mostly fake — emissive heads, additive glow sprites and ground light-pool
 * decals — driven by a single `nightFactor`; the real lighting comes from a
 * small shared {@link createLampLights} pool. Non-fatal: any failure (or a
 * missing/empty file) resolves to an empty group.
 */
export async function loadLamps(
  url: string,
  ctx: VegetationContext
): Promise<LampControl> {
  const group = new Group();
  group.name = "lamps";
  const { offset } = ctx;
  const features = await fetchFeatures<LampPoint>(url, ctx.signal);

  const places: Place[] = [];
  const headPositions: Vector3[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point") {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue; // off-tile / NoData
    }
    const { x, z } = epsgToWorld(ex, ey, offset);
    places.push({ x, y: ground, z });
    headPositions.push(new Vector3(x, ground + LAMP_H, z));
  }

  if (places.length === 0) {
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

  const sprite = makeGlowSprite();
  const posts = buildPosts(places);
  const heads = buildHeads(places);
  const glow = buildGlow(headPositions, sprite);
  const decals = buildDecals(places, sprite);
  group.add(posts, heads, glow, decals);

  const headMat = heads.material as MeshStandardMaterial;
  const glowMat = glow.material as PointsMaterial;
  const decalMat = decals.material as MeshBasicMaterial;

  return {
    group,
    headPositions,
    setNightFactor: (t) => {
      const nf = Math.min(Math.max(t, 0), 1);
      headMat.emissiveIntensity = nf * HEAD_EMISSIVE;
      glowMat.opacity = nf * GLOW_OPACITY;
      decalMat.opacity = nf * POOL_OPACITY;
      glow.visible = nf > 0.01;
      decals.visible = nf > 0.01;
    },
    dispose: () => {
      for (const m of [posts, heads, decals]) {
        m.geometry.dispose();
        (m.material as MeshStandardMaterial).dispose();
      }
      glow.geometry.dispose();
      glowMat.dispose();
      // disposeObject3D won't free the shared CanvasTexture — do it here.
      sprite.dispose();
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
 * ONCE (so `NUM_POINT_LIGHTS` is constant — no recompile churn), never added or
 * removed; at midday they simply sit at intensity 0. Each frame they jump to the
 * nearest lamp heads with a distance falloff so the hand-off is invisible.
 */
export function createLampLights(heads: Vector3[]): LampLights {
  const count = Math.min(MAX_REAL_LAMPS, heads.length);
  const lights: PointLight[] = [];
  for (let i = 0; i < count; i++) {
    const light = new PointLight(0xff_d0_89, 0, LIGHT_RANGE, 2);
    light.castShadow = false;
    lights.push(light);
  }
  let nightFactor = 0;

  return {
    lights,
    setNightFactor: (t) => {
      nightFactor = Math.min(Math.max(t, 0), 1);
    },
    updateNearest: (camPos) => {
      if (lights.length === 0 || nightFactor <= 0.001) {
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
