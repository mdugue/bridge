import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
} from "three";
import {
  buildDetailAttributes,
  type CityMeshMeta,
  type CityMeshVertices,
  countBuildings as countLiveBuildings,
  decodeCityMesh,
  doomedObjects,
  filterVertices,
  footprintPolys,
  parseCityMeshMeta,
} from "@/lib/city/city-mesh";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { TileUrls } from "@/lib/city/tile";
import { buildCityBvh } from "./collision";
import {
  type BytesProgress,
  fetchGzipped,
  fetchRequiredJson,
} from "./fetch-optional";
import { disposeObject3D } from "./three-utils";

/**
 * One tile's buildings: the baked mesh (scripts/bake-city-mesh.ts, format in
 * lib/city/city-mesh.ts) as a single batched Mesh with the per-vertex
 * attributes the clay style reads. Demolish filters the vertex stream and
 * rebuilds the geometry — no CityJSON and no parser in the browser.
 */
export interface CityLayer {
  /** false for objects demolished this session (index into meta.objects) */
  alive: Uint8Array;
  /** current mesh, wrapped in a group (re-created on every demolish) */
  group: Group;
  meta: CityMeshMeta;
  /** the live vertex stream (shrinks when demolishing) */
  vertices: CityMeshVertices;
}

/** Marker the style/collision helpers look for on batched city meshes. */
interface CityMesh extends Mesh {
  isCityObjectMesh?: boolean;
}

/**
 * Fetches a tile's baked mesh (meta + inflated vertex stream). `onBytes`
 * reports the vertex stream's download progress — the primary tile's is the
 * largest single wait before the first frame.
 */
export async function fetchCityMesh(
  tile: Pick<TileUrls, "cityMeshData" | "cityMeshMeta">,
  signal?: AbortSignal,
  onBytes?: BytesProgress
): Promise<{ meta: CityMeshMeta; vertices: CityMeshVertices }> {
  const [metaJson, buffer] = await Promise.all([
    fetchRequiredJson<unknown>(tile.cityMeshMeta, signal),
    fetchGzipped(tile.cityMeshData, signal, onBytes),
  ]);
  const meta = parseCityMeshMeta(metaJson);
  return { meta, vertices: decodeCityMesh(buffer, meta) };
}

/**
 * Builds the batched mesh from a vertex stream. Flat per-face normals come
 * from computeVertexNormals on the non-indexed stream; the clay attributes
 * (aBaseZ, aTint, aBuild, aRough — see visual-style.ts) expand the meta's
 * per-object table. The placeholder material is swapped for the shared clay
 * by applyCityStyle right after.
 */
function buildMesh(meta: CityMeshMeta, v: CityMeshVertices): Group {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(v.positions, 3));
  geometry.setAttribute("objectid", new BufferAttribute(v.objectIds, 1));
  const detail = buildDetailAttributes(meta, v);
  geometry.setAttribute("aBaseZ", new BufferAttribute(detail.baseZ, 1));
  geometry.setAttribute("aTint", new BufferAttribute(detail.tint, 3));
  geometry.setAttribute("aBuild", new BufferAttribute(detail.build, 4));
  geometry.setAttribute("aRough", new BufferAttribute(detail.rough, 1));
  geometry.computeVertexNormals();
  const mesh: CityMesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.isCityObjectMesh = true;
  mesh.name = `city:${meta.tile}`;
  // Casting works with three's default depth pass; receiving works because
  // the clay material is a lit MeshStandardMaterial.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new Group();
  group.name = `city-tile:${meta.tile}`;
  group.add(mesh);
  // BVHs make per-frame collision rays (and demolish picks) cheap.
  buildCityBvh(group);
  return group;
}

/**
 * Every tile's layer is demolishable, so the vertex stream (~15 bytes per
 * vertex the filter needs) is kept for all of them.
 */
export function createCityLayer(
  meta: CityMeshMeta,
  vertices: CityMeshVertices,
  world: Group
): CityLayer {
  const group = buildMesh(meta, vertices);
  world.add(group);
  return {
    meta,
    vertices,
    alive: new Uint8Array(meta.objects.length).fill(1),
    group,
  };
}

/**
 * Demolish = drop the object's whole building tree from the vertex stream
 * and rebuild the batched mesh. Hiding one building in a batched mesh is
 * impossible, but filtering ~400k vertices is a few milliseconds.
 */
export function demolishObject(
  layer: CityLayer,
  world: Group,
  objectIndex: number
): CityLayer {
  const doomed = doomedObjects(layer.meta, objectIndex);
  if (doomed.size === 0 || layer.vertices.objectIds.length === 0) {
    return layer;
  }
  const alive = layer.alive.slice();
  for (const i of doomed) {
    alive[i] = 0;
  }
  const vertices = filterVertices(layer.vertices, (i) => alive[i] === 1);
  world.remove(layer.group);
  disposeObject3D(layer.group);
  const group = buildMesh(layer.meta, vertices);
  world.add(group);
  return { meta: layer.meta, vertices, alive, group };
}

// Hoisted: demolish picks happen on a key press, but there's no reason to
// allocate per call. firstHitOnly stops the BVH walk at the nearest hit
// instead of collecting and sorting every intersection along the ray.
const pickRaycaster = new Raycaster();
pickRaycaster.firstHitOnly = true;
const SCREEN_CENTER = new Vector2(0, 0);

/** What a demolish pick aimed at: a layer (by index) and an object in it. */
export interface CityPick {
  layerIndex: number;
  objectIndex: number;
}

/**
 * Raycasts the screen center against every tile's buildings and resolves the
 * nearest aimed object, or null.
 */
export function pickCityObject(
  camera: Camera,
  layers: readonly CityLayer[]
): CityPick | null {
  pickRaycaster.setFromCamera(SCREEN_CENTER, camera);
  const hit = pickRaycaster.intersectObjects(
    layers.map((l) => l.group),
    true
  )[0];
  const face = hit?.face;
  if (!face) {
    return null;
  }
  const layerIndex = layers.findIndex((l) => l.group === hit.object.parent);
  const ids = (hit.object as Mesh).geometry.getAttribute("objectid");
  if (layerIndex < 0 || !ids) {
    return null;
  }
  return { layerIndex, objectIndex: ids.getX(face.a) };
}

export function countBuildings(layer: CityLayer): number {
  return countLiveBuildings(layer.meta, (i) => layer.alive[i] === 1);
}

/** Live building footprints (EPSG) for the minimap. */
export function cityFootprints(layer: CityLayer): FootprintPoly[] {
  return footprintPolys(layer.meta, (i) => layer.alive[i] === 1);
}
