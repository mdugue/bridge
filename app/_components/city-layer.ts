import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import type { Camera, Group, Matrix4 } from "three";
import { Raycaster, Vector2 } from "three";
import { filterCityObject } from "@/lib/city/filter-city-object";
import type { CityJsonDocument } from "@/lib/city/types";
import { buildCityBvh } from "./collision";
import { disposeObject3D, enableShadows } from "./three-utils";

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
  enableShadows(loader.scene);
  // BVHs make per-frame collision rays (and demolish picks) cheap.
  buildCityBvh(loader.scene);
  return { group: loader.scene, matrix: loader.matrix };
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
