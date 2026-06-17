import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import type { BufferGeometry, Camera, Group, Matrix4, Mesh } from "three";
import { BufferAttribute, Raycaster, Vector2 } from "three";
import {
  buildingGlows,
  buildingTint,
  type RoofColorLut,
  roofColor,
  roofTint,
  roughJitter,
  storeyHeight,
} from "@/lib/city/building-tint";
import { filterCityObject } from "@/lib/city/filter-city-object";
import type { CityJsonDocument } from "@/lib/city/types";
import { buildCityBvh } from "./collision";
import { disposeObject3D } from "./three-utils";

export interface CityLayer {
  /** mutable in-memory CityJSON — the source of truth for demolish */
  data: CityJsonDocument;
  /** current loader output (re-created on every reload) */
  group: Group;
  /**
   * Pure-translation recenter matrix captured on the FIRST load and reused
   * on every reload, so the world never jumps after a demolish.
   */
  matrix: Matrix4;
  /** optional DOP-sampled roof colours, reused on demolish re-parse */
  roofLut?: RoofColorLut;
}

/** Duck-type of the loader's mesh subclasses we care about when picking. */
interface CityObjectsMeshLike {
  isCityObject?: boolean;
  resolveIntersectionInfo?: (hit: unknown) => { objectId?: string };
}

/**
 * Synchronous CityJSONParser on purpose: CityJSONWorkerParser uses
 * `new Worker(new URL(..., import.meta.url))`, a Next.js bundling hazard.
 */
function parseCity(
  data: CityJsonDocument,
  matrix: Matrix4 | null,
  roofLut: RoofColorLut | undefined
): { group: Group; matrix: Matrix4 } {
  const loader = new CityJSONLoader(new CityJSONParser());
  if (matrix) {
    loader.matrix = matrix;
  }
  loader.load(data);
  // Shadow flags for the batched building meshes. Casting works with three's
  // default depth pass (the geometry has a plain `position` attribute);
  // receiving works because CityObjectsMaterial is lambert-based with
  // `lights: true`.
  loader.scene.traverse((obj) => {
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  annotateBaseHeight(loader.scene);
  annotateBuildingDetail(loader.scene, data, roofLut);
  // BVHs make per-frame collision rays (and demolish picks) cheap.
  buildCityBvh(loader.scene);
  return { group: loader.scene, matrix: loader.matrix };
}

/**
 * Writes a per-vertex `aBaseZ` attribute = the lowest local-Z (elevation, since
 * the geometry is data-frame Z-up) of each building, looked up by the loader's
 * per-vertex `objectid`. The clay material's shader uses `position.z - aBaseZ`
 * as the height ABOVE each building's own base — so the ground-contact gradient
 * and storey bands sit correctly even though buildings stand on terrain at
 * different elevations. Skips meshes without an `objectid` attribute.
 */
function annotateBaseHeight(group: Group): void {
  group.traverse((obj) => {
    const geom = (obj as Mesh).geometry as BufferGeometry | undefined;
    const pos = geom?.attributes.position;
    const oid = geom?.attributes.objectid;
    if (!(geom && pos && oid)) {
      return;
    }
    const minZ = new Map<number, number>();
    for (let i = 0; i < pos.count; i++) {
      const id = oid.getX(i);
      const z = pos.getZ(i);
      const cur = minZ.get(id);
      if (cur === undefined || z < cur) {
        minZ.set(id, z);
      }
    }
    const base = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      base[i] = minZ.get(oid.getX(i)) ?? pos.getZ(i);
    }
    geom.setAttribute("aBaseZ", new BufferAttribute(base, 1));
  });
}

/** RoofSurface index in the loader's fixed `defaultSemanticsColors` key order
 *  (GroundSurface 0, WallSurface 1, RoofSurface 2). A vertex without semantics
 *  is -1, so this never false-matches a wall. */
const ROOF_SURFACE_TYPE = 2;

interface BuildingStyle {
  /** eave height above the building base (m): lowest roof vertex, or the full
   *  height when no roof surface is tagged */
  eaveH: number;
  /** 1 = warm dusk glow (commerce/public/special), 0 = housing */
  glow: number;
  roof: [number, number, number];
  /** synthesized terracotta/slate roof colour — the warmth-blend target */
  roofWarm: [number, number, number];
  /** signed roughness jitter [-1,1] */
  rough: number;
  /** contour-band spacing (m), snapped to whole storeys */
  storeyH: number;
  wall: [number, number, number];
}

/** Reads the loader's per-vertex `surfacetype` (may be absent on non-LoD2). */
type SurfaceAttr = { getX: (i: number) => number } | undefined;

/** Per-building style, computed once and reused across the building's vertices. */
function buildingStyle(
  id: string,
  attrs: Record<string, unknown> | undefined,
  baseZ: number,
  maxZ: number,
  roofMinZ: number | undefined,
  roofLut: RoofColorLut | undefined
): BuildingStyle {
  const a = attrs ?? {};
  const total = maxZ - baseZ;
  const mh = typeof a.measuredHeight === "number" ? a.measuredHeight : total;
  return {
    wall: buildingTint(id, a),
    roof: roofColor(id, a, roofLut),
    roofWarm: roofTint(id, a),
    storeyH: storeyHeight(mh),
    eaveH: roofMinZ === undefined ? total : Math.max(roofMinZ - baseZ, 0),
    glow: buildingGlows(a) ? 1 : 0,
    rough: roughJitter(id),
  };
}

/** First pass: per-building lowest ROOF vertex (for the eave) and overall top. */
function scanRoofAndTop(
  pos: { count: number; getZ: (i: number) => number },
  oid: { getX: (i: number) => number },
  surf: SurfaceAttr
): { roofMinZ: Map<number, number>; maxZ: Map<number, number> } {
  const roofMinZ = new Map<number, number>();
  const maxZ = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const idx: number = oid.getX(i);
    const z = pos.getZ(i);
    const mx = maxZ.get(idx);
    if (mx === undefined || z > mx) {
      maxZ.set(idx, z);
    }
    if (surf?.getX(i) === ROOF_SURFACE_TYPE) {
      const rm = roofMinZ.get(idx);
      if (rm === undefined || z < rm) {
        roofMinZ.set(idx, z);
      }
    }
  }
  return { roofMinZ, maxZ };
}

/** Mutable per-mesh attribute buffers, filled vertex-by-vertex. */
interface DetailBuffers {
  build: Float32Array;
  rough: Float32Array;
  tint: Float32Array;
  warm: Float32Array;
}

const ZERO_RGB: [number, number, number] = [0, 0, 0];

/** Writes one vertex's detail attributes: roof/wall colour → aTint, the synth
 *  warmth-blend target → aRoofWarm (roof verts only), plus aBuild and aRough. */
function writeVertexAttrs(
  b: DetailBuffers,
  i: number,
  s: BuildingStyle,
  isRoof: number
): void {
  const c = isRoof === 1 ? s.roof : s.wall;
  const w = isRoof === 1 ? s.roofWarm : ZERO_RGB;
  b.tint[i * 3] = c[0];
  b.tint[i * 3 + 1] = c[1];
  b.tint[i * 3 + 2] = c[2];
  b.warm[i * 3] = w[0];
  b.warm[i * 3 + 1] = w[1];
  b.warm[i * 3 + 2] = w[2];
  b.build[i * 4] = isRoof;
  b.build[i * 4 + 1] = s.storeyH;
  b.build[i * 4 + 2] = s.eaveH;
  b.build[i * 4 + 3] = s.glow;
  b.rough[i] = s.rough;
}

/**
 * Writes the per-vertex attributes the clay shader reads to individualise each
 * building (all keyed by the loader's `objectid` index → CityObject attributes,
 * computed once per building and cached):
 *  - `aTint` (vec3): wall colour on wall faces, ROOF colour on RoofSurface faces
 *    (roofType/Dachneigung → terracotta or slate).
 *  - `aBuild` (vec4): (isRoof, storeyHeight, eaveHeight, glowFlag). isRoof is
 *    per-vertex; the rest are per-building.
 *  - `aRough` (float): per-building roughness jitter.
 * Needs `aBaseZ` (written by annotateBaseHeight) for heights; reads the loader's
 * `surfacetype` to tell roofs from walls (absent → everything treated as wall).
 */
function annotateBuildingDetail(
  group: Group,
  data: CityJsonDocument,
  roofLut: RoofColorLut | undefined
): void {
  const keys = Object.keys(data.CityObjects);
  group.traverse((obj) => {
    const geom = (obj as Mesh).geometry as BufferGeometry | undefined;
    const pos = geom?.attributes.position;
    const oid = geom?.attributes.objectid;
    const baseAttr = geom?.attributes.aBaseZ;
    if (!(geom && pos && oid && baseAttr)) {
      return;
    }
    const surf = geom.attributes.surfacetype as SurfaceAttr;
    const { roofMinZ, maxZ } = scanRoofAndTop(pos, oid, surf);
    const cache = new Map<number, BuildingStyle>();
    const buffers: DetailBuffers = {
      tint: new Float32Array(pos.count * 3),
      warm: new Float32Array(pos.count * 3),
      build: new Float32Array(pos.count * 4),
      rough: new Float32Array(pos.count),
    };
    for (let i = 0; i < pos.count; i++) {
      const idx: number = oid.getX(i);
      let s = cache.get(idx);
      if (!s) {
        const key = keys[idx];
        const baseZ = baseAttr.getX(i);
        s = buildingStyle(
          key ?? String(idx),
          data.CityObjects[key]?.attributes,
          baseZ,
          maxZ.get(idx) ?? baseZ,
          roofMinZ.get(idx),
          roofLut
        );
        cache.set(idx, s);
      }
      const isRoof = surf?.getX(i) === ROOF_SURFACE_TYPE ? 1 : 0;
      writeVertexAttrs(buffers, i, s, isRoof);
    }
    geom.setAttribute("aTint", new BufferAttribute(buffers.tint, 3));
    geom.setAttribute("aRoofWarm", new BufferAttribute(buffers.warm, 3));
    geom.setAttribute("aBuild", new BufferAttribute(buffers.build, 4));
    geom.setAttribute("aRough", new BufferAttribute(buffers.rough, 1));
  });
}

export function createCityLayer(
  data: CityJsonDocument,
  world: Group,
  /** shared recenter matrix; pass the primary tile's so neighbours align */
  sharedMatrix: Matrix4 | null = null,
  /** optional DOP-sampled per-building roof colours (else synthesized) */
  roofLut?: RoofColorLut
): CityLayer {
  const { group, matrix } = parseCity(data, sharedMatrix, roofLut);
  world.add(group);
  return { data, group, matrix, roofLut };
}

/**
 * Demolish = remove the object's building tree from the CityJSON and
 * re-parse. The loader batches ~2000 buildings per mesh (per-vertex
 * `objectid` attribute), so hiding a single building via `visible = false`
 * is impossible — a data-level rebuild is the supported path.
 */
export function demolishObject(
  layer: CityLayer,
  world: Group,
  objectId: string
): CityLayer {
  const filtered = filterCityObject(layer.data, objectId);
  if (filtered === layer.data) {
    return layer;
  }
  world.remove(layer.group);
  disposeObject3D(layer.group);
  const { group } = parseCity(filtered, layer.matrix, layer.roofLut);
  world.add(group);
  return {
    data: filtered,
    group,
    matrix: layer.matrix,
    roofLut: layer.roofLut,
  };
}

/** Raycasts the screen center and resolves the aimed CityObject id. */
export function pickCityObjectId(
  camera: Camera,
  layer: CityLayer
): string | null {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  for (const hit of raycaster.intersectObject(layer.group, true)) {
    const obj = hit.object as unknown as CityObjectsMeshLike;
    if (obj.isCityObject && obj.resolveIntersectionInfo) {
      return obj.resolveIntersectionInfo(hit).objectId ?? null;
    }
  }
  return null;
}

export function countBuildings(data: CityJsonDocument): number {
  let count = 0;
  for (const obj of Object.values(data.CityObjects)) {
    if (obj.type === "Building") {
      count += 1;
    }
  }
  return count;
}
