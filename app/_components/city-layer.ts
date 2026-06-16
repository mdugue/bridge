import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import type { BufferGeometry, Camera, Group, Matrix4, Mesh } from "three";
import { BufferAttribute, Raycaster, Vector2 } from "three";
import { buildingTint } from "@/lib/city/building-tint";
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
  matrix: Matrix4 | null
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
  annotateTint(loader.scene, data);
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

/**
 * Writes a per-vertex `aTint` attribute (linear RGB) so the clay shader can give
 * each building its own muted clay-family colour instead of one flat mass — see
 * `buildingTint` for how the colour is chosen. The loader stores a vertex's
 * building as an INDEX into `Object.keys(CityObjects)` (its `objectid`
 * attribute), so we resolve that to the CityObject's id + attributes. Buildings
 * span many vertices, so each tint is computed once per object and cached.
 * Skips meshes without an `objectid` attribute (e.g. anything non-batched).
 */
function annotateTint(group: Group, data: CityJsonDocument): void {
  const keys = Object.keys(data.CityObjects);
  group.traverse((obj) => {
    const geom = (obj as Mesh).geometry as BufferGeometry | undefined;
    const pos = geom?.attributes.position;
    const oid = geom?.attributes.objectid;
    if (!(geom && pos && oid)) {
      return;
    }
    const cache = new Map<number, [number, number, number]>();
    const tint = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const idx: number = oid.getX(i);
      let rgb = cache.get(idx);
      if (!rgb) {
        const key = keys[idx];
        rgb = buildingTint(
          key ?? String(idx),
          data.CityObjects[key]?.attributes
        );
        cache.set(idx, rgb);
      }
      tint[i * 3] = rgb[0];
      tint[i * 3 + 1] = rgb[1];
      tint[i * 3 + 2] = rgb[2];
    }
    geom.setAttribute("aTint", new BufferAttribute(tint, 3));
  });
}

export function createCityLayer(
  data: CityJsonDocument,
  world: Group,
  /** shared recenter matrix; pass the primary tile's so neighbours align */
  sharedMatrix: Matrix4 | null = null
): CityLayer {
  const { group, matrix } = parseCity(data, sharedMatrix);
  world.add(group);
  return { data, group, matrix };
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
  const { group } = parseCity(filtered, layer.matrix);
  world.add(group);
  return { data: filtered, group, matrix: layer.matrix };
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
