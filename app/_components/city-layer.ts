import {
  Box3,
  BufferAttribute,
  type Camera,
  DataTexture,
  FloatType,
  type Intersection,
  type Matrix4,
  type Mesh,
  NearestFilter,
  type Ray,
  RGBAFormat,
  Raycaster,
  Vector2,
} from "three/webgpu";
import { rayEntry } from "./collision";
import { streamTimings } from "./stream-timing";
import { setPickRay } from "./view-ray";
import {
  type CityObjectTable,
  countBuildings as countLiveBuildings,
  OBJECT_FLAG_ASKED,
  doomedObjects,
  liveTriangles,
  OBJECT_TEXEL_BANDS,
  OBJECT_TEXTURE_WIDTH,
  objectBandRows,
  packObjectTexels,
} from "@/lib/city/city-mesh";
import { type ObjectFacts, readFacts } from "@/lib/city/object-facts";
import type { StructuralMetadata } from "@/lib/city/property-table";
import {
  applyFacadeReadings,
  type FacadeReadings,
} from "@/lib/city/facade-reading";
import { textureBytes, trackTexture } from "./three-utils";
import { createClayMaterial, type StyleResources } from "./visual-style";

/**
 * One tile's buildings: the streamed glTF mesh (scripts/bake-city-mesh.ts), its
 * per-object table (EXT_structural_metadata, read by gltf-content.ts) as a
 * float texture the clay shader reads per vertex, and the demolish state.
 * Demolish filters the index buffer — no re-parse, no vertex copies.
 */
export interface CityLayer {
  /** false for objects demolished this session */
  alive: Uint8Array;
  /** drops the object's building tree; true when anything changed */
  demolish: (objectIndex: number) => boolean;
  dispose: () => void;
  /** what street photos say about the tile's facades, once they land
   *  (lib/city/facade-reading.ts) */
  facadeReadings: (readings: FacadeReadings) => void;
  /** what the twin knows about one object (read from the table on demand) */
  facts: (objectIndex: number) => ObjectFacts;
  /** whether the tile's BVH is built (`ensureCityBvh`) */
  hasBvh: () => boolean;
  /** builds the tile's BVH unless it has one (a long task: ≈75 ms for a
   *  dense tile on a desktop, several times that on a phone) */
  ensureBvh: () => void;
  /** marks the objects someone asks about (the clay's pencil hatch); an
   *  empty set clears the mark */
  mark: (objects: ReadonlySet<number>) => void;
  mesh: Mesh;
  table: CityObjectTable;
  /** what the table's columns and the texture packed from them keep on the
   *  page's process (bytes): the mark writes into the texture's data */
  tableBytes: number;
  tile: string;
}

/** The bytes of an object's typed-array members. */
function typedBytes(record: object): number {
  let bytes = 0;
  for (const value of Object.values(record)) {
    if (ArrayBuffer.isView(value)) {
      bytes += value.byteLength;
    }
  }
  return bytes;
}

/** Marker the collision helpers look for on city meshes. */
export interface CityMesh extends Mesh {
  isCityObjectMesh?: boolean;
}

const xyz = (v: unknown): number[] => {
  const p = v as { x?: number; y?: number; z?: number } | number[];
  return Array.isArray(p) ? p : [p.x ?? 0, p.y ?? 0, p.z ?? 0];
};

/**
 * Reads the style columns of the property table into typed columns. Column
 * by column rather than row by row: a row read would decode every fact
 * string of every object, which only the inquiry card ever needs.
 */
export function readObjectTable(
  metadata: StructuralMetadata,
  count: number
): CityObjectTable {
  const table: CityObjectTable = {
    count,
    baseZ: new Float32Array(count),
    building: new Uint8Array(count),
    eaveH: new Float32Array(count),
    flags: new Uint16Array(count),
    glow: new Uint8Array(count),
    roof: new Float32Array(count * 3),
    root: new Uint32Array(count),
    rough: new Float32Array(count),
    source: new Uint8Array(count),
    storeyH: new Float32Array(count),
    tint: new Float32Array(count * 3),
    winAxis: new Float32Array(count),
    winH: new Float32Array(count),
    winStyle: new Uint32Array(count),
    winW: new Float32Array(count),
  };
  const accessor = metadata.tableAccessors[0];
  const scalar = (
    name: string,
    out: Float32Array | Uint8Array | Uint16Array | Uint32Array
  ) => {
    // absent columns stay 0 (`source` before plan 034: LoD2)
    if (!(accessor && name in accessor.properties)) {
      return;
    }
    for (let i = 0; i < count; i++) {
      out[i] = Number(accessor.getPropertyValue(name, i));
    }
  };
  const vec3 = (name: string, out: Float32Array) => {
    for (let i = 0; i < count; i++) {
      out.set(xyz(accessor?.getPropertyValue(name, i)), i * 3);
    }
  };
  scalar("baseZ", table.baseZ);
  scalar("building", table.building);
  scalar("eaveH", table.eaveH);
  scalar("flags", table.flags);
  scalar("glow", table.glow);
  scalar("root", table.root);
  scalar("rough", table.rough);
  scalar("source", table.source);
  scalar("storeyH", table.storeyH);
  // a tile baked before the windows has none (absent columns stay 0)
  scalar("winAxis", table.winAxis);
  scalar("winH", table.winH);
  scalar("winStyle", table.winStyle);
  scalar("winW", table.winW);
  vec3("roof", table.roof);
  vec3("tint", table.tint);
  return table;
}

/** One object's facts from the tile's table (ADR 0042); a tile baked before
 *  the fact columns answers with unknowns and its feature index. */
function readObjectFacts(
  metadata: StructuralMetadata,
  objectIndex: number
): ObjectFacts {
  const accessor = metadata.tableAccessors[0];
  return readFacts(
    (column) =>
      accessor && column in accessor.properties
        ? accessor.getPropertyValue(column, objectIndex)
        : undefined,
    `#${objectIndex}`
  );
}

/**
 * Writes the asked flag into the packed table's flags texel (band 2, w):
 * set on `marked`, cleared everywhere else. True when a texel changed.
 */
function markObjects(
  texture: DataTexture,
  table: CityObjectTable,
  marked: ReadonlySet<number>
): boolean {
  const data = texture.image.data as Float32Array;
  const band = OBJECT_TEXTURE_WIDTH * objectBandRows(table.count) * 4;
  let changed = false;
  for (let i = 0; i < table.count; i++) {
    const want = table.flags[i] + (marked.has(i) ? OBJECT_FLAG_ASKED : 0);
    const at = 2 * band + i * 4 + 3;
    if (data[at] !== want) {
      data[at] = want;
      changed = true;
    }
  }
  return changed;
}

function objectTexture(table: CityObjectTable): {
  rows: number;
  texture: DataTexture;
} {
  const rows = objectBandRows(table.count);
  const height = rows * OBJECT_TEXEL_BANDS;
  const texture = new DataTexture(
    packObjectTexels(table),
    OBJECT_TEXTURE_WIDTH,
    height,
    RGBAFormat,
    FloatType
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  trackTexture(texture, textureBytes(OBJECT_TEXTURE_WIDTH, height, 16, false));
  return { rows, texture };
}

/**
 * Builds a building tile's BVH unless it has one — when a ray first needs
 * it, not as the tile lands. The build held a dense tile's parse on the
 * main thread (≈75 ms on a desktop, several times that on a phone) and
 * allocated six floats per triangle beside the node buffers it keeps (≈50
 * MB for two million triangles) while the boot's other contents were still
 * parsing; a tile that stays far away needs none (the collider, the picks
 * and the autofocus pass over it, or build it as their ray reaches it:
 * collision.ts, `nearestCityHit`, `cityObjectsAlong`; `nearestWithoutBvh`
 * finds the ones near the camera, built in idle time — create-app.ts).
 * three-mesh-bvh sorts the index in place and does not mark it for upload:
 * the GPU keeps the order it was given, the same triangles.
 */
export function ensureCityBvh(mesh: Mesh): void {
  if (!mesh.geometry.boundsTree) {
    streamTimings.timedSync(
      "tile:bvh",
      () => mesh.geometry.computeBoundsTree(),
      mesh.name
    );
  }
}

/**
 * Dresses a streamed city mesh: the glTF feature id and place on the wall
 * (the windows', a roof vertex flagged in it) under the names the clay
 * shader reads, the tile's clay material; its BVH comes when a ray needs
 * it (`ensureCityBvh`). `demolished` replays this session's demolitions of
 * the tile.
 */
export function dressCity(
  mesh: Mesh,
  tile: string,
  resources: StyleResources,
  demolished: ReadonlySet<number>
): CityLayer {
  const geometry = mesh.geometry;
  const metadata = mesh.userData.structuralMetadata as StructuralMetadata;
  const count = metadata.tableAccessors[0]?.count ?? 0;
  for (const [from, to] of [
    ["_feature_id_0", "featureId"],
    ["_facade", "facade"],
  ] as const) {
    const attribute = geometry.getAttribute(from);
    if (attribute) {
      geometry.setAttribute(to, attribute);
      geometry.deleteAttribute(from);
    }
  }
  const table = readObjectTable(metadata, count);
  const objects = objectTexture(table);
  mesh.material = createClayMaterial(resources, objects);
  (mesh as CityMesh).isCityObjectMesh = true;
  mesh.name = `city:${tile}`;
  // Casting works with three's default shadow pass; receiving works because
  // the clay is a lit standard node material.
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const alive = new Uint8Array(count).fill(1);
  const featureIds = geometry.getAttribute("featureId");
  const rebuild = () => {
    const index = geometry.getIndex();
    if (!index) {
      return;
    }
    const had = Boolean(geometry.boundsTree);
    geometry.setIndex(
      new BufferAttribute(
        liveTriangles(index.array, featureIds.array, (i) => alive[i] === 1),
        1
      )
    );
    // A BVH is built over its index: a new index needs a new one — now
    // where there was one (a demolish picks through it), else when a ray
    // needs it.
    geometry.disposeBoundsTree();
    if (had) {
      geometry.computeBoundsTree();
    }
  };
  for (const i of demolished) {
    alive[i] = 0;
  }
  if (demolished.size > 0) {
    rebuild();
  }

  // the asked objects, kept for the facade readings' repack
  let marked: ReadonlySet<number> = new Set();
  const layer: CityLayer = {
    tile,
    mesh,
    table,
    tableBytes:
      typedBytes(table) +
      (objects.texture.image.data as Float32Array).byteLength,
    alive,
    demolish: (objectIndex) => {
      const doomed = doomedObjects(table.root, objectIndex);
      if (doomed.size === 0) {
        return false;
      }
      for (const i of doomed) {
        alive[i] = 0;
      }
      rebuild();
      return true;
    },
    dispose: () => {
      geometry.disposeBoundsTree();
      objects.texture.dispose();
    },
    facadeReadings: (readings) => {
      const ids = metadata.tableAccessors[0];
      if (
        ids &&
        "buildingId" in ids.properties &&
        applyFacadeReadings(
          table.flags,
          (i) => String(ids.getPropertyValue("buildingId", i)),
          readings
        ) &&
        markObjects(objects.texture, table, marked)
      ) {
        objects.texture.needsUpdate = true;
      }
    },
    facts: (objectIndex) => readObjectFacts(metadata, objectIndex),
    hasBvh: () => Boolean(geometry.boundsTree),
    ensureBvh: () => ensureCityBvh(mesh),
    mark: (next) => {
      marked = next;
      if (markObjects(objects.texture, table, marked)) {
        objects.texture.needsUpdate = true;
      }
    },
  };
  return layer;
}

/** A mesh's world box, kept while its matrix stays. */
const boxes = new WeakMap<Mesh, { box: Box3; matrix: Matrix4 }>();

function worldBox(mesh: Mesh): Box3 {
  let kept = boxes.get(mesh);
  if (!kept?.matrix.equals(mesh.matrixWorld)) {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    kept = {
      box: (geometry.boundingBox ?? new Box3())
        .clone()
        .applyMatrix4(mesh.matrixWorld),
      matrix: mesh.matrixWorld.clone(),
    };
    boxes.set(mesh, kept);
  }
  return kept.box;
}

/** The layers whose box `ray` enters within `far`, nearest entry first
 *  (0 from inside a box: `rayEntry`). */
function layersOnRay(
  ray: Ray,
  far: number,
  layers: readonly CityLayer[]
): { enter: number; layer: CityLayer }[] {
  const out: { enter: number; layer: CityLayer }[] = [];
  for (const layer of layers) {
    const enter = rayEntry(ray, worldBox(layer.mesh));
    if (enter !== null && enter <= far) {
      out.push({ enter, layer });
    }
  }
  return out.sort((a, b) => a.enter - b.enter);
}

/**
 * The nearest building surface along `raycaster`'s ray (within its `far`),
 * the tiles taken nearest box first until none ahead can hold a nearer
 * one. A tile without a BVH is built first where `build` (a pick, a double
 * tap: once, at a user's word) and passed over otherwise (the autofocus) —
 * never walked triangle by triangle, which three-mesh-bvh's raycast falls
 * back to on a mesh without one.
 */
export function nearestCityHit(
  raycaster: Raycaster,
  layers: readonly CityLayer[],
  build: boolean
): { hit: Intersection; layer: CityLayer } | null {
  let best: { hit: Intersection; layer: CityLayer } | null = null;
  for (const { enter, layer } of layersOnRay(
    raycaster.ray,
    raycaster.far,
    layers
  )) {
    if (best && enter > best.hit.distance) {
      break;
    }
    if (build) {
      layer.ensureBvh();
    }
    if (!layer.hasBvh()) {
      continue;
    }
    const hit = raycaster.intersectObject(layer.mesh, false)[0];
    if (hit && (!best || hit.distance < best.hit.distance)) {
      best = { hit, layer };
    }
  }
  return best;
}

/**
 * The building tile nearest world (x, z) without a BVH, within `reach` m
 * of its box (in plan; 0 inside it), or null: the one create-app.ts builds
 * next in idle time, so a walk into a neighbouring tile finds it ready.
 */
export function nearestWithoutBvh(
  layers: readonly CityLayer[],
  x: number,
  z: number,
  reach: number
): CityLayer | null {
  let best: CityLayer | null = null;
  let bestDistance = reach;
  for (const layer of layers) {
    if (layer.hasBvh()) {
      continue;
    }
    const { min, max } = worldBox(layer.mesh);
    const dx = Math.max(min.x - x, 0, x - max.x);
    const dz = Math.max(min.z - z, 0, z - max.z);
    const distance = Math.hypot(dx, dz);
    if (distance <= bestDistance) {
      best = layer;
      bestDistance = distance;
    }
  }
  return best;
}

// Hoisted: picks happen on a key press or a click, but there's no reason to
// allocate per call. firstHitOnly stops the BVH walk at the nearest hit
// instead of collecting and sorting every intersection along the ray.
const pickRaycaster = new Raycaster();
pickRaycaster.firstHitOnly = true;
const SCREEN_CENTER = new Vector2(0, 0);
const pickAt = new Vector2();

/**
 * Raycasts over `layers` through a screen point (normalized device
 * coordinates; the screen centre, the crosshair, by default): the nearest
 * object hit and how far along the ray, the tiles it reaches built as it
 * does (`nearestCityHit`). `raycaster` is left set to the ray, so a caller
 * can test the ground along it.
 */
export function pickCityObject(
  camera: Camera,
  layers: readonly CityLayer[],
  ndc?: { x: number; y: number }
): {
  distance: number;
  layer: CityLayer;
  objectIndex: number;
  raycaster: Raycaster;
} | null {
  // any camera, Modell's sheared parallel one too (view-ray.ts)
  pickRaycaster.far = setPickRay(
    pickRaycaster,
    ndc ? pickAt.set(ndc.x, ndc.y) : SCREEN_CENTER,
    camera
  );
  const found = nearestCityHit(pickRaycaster, layers, true);
  const face = found?.hit.face;
  if (!(found && face)) {
    return null;
  }
  const { hit, layer } = found;
  const ids = layer.mesh.geometry.getAttribute("featureId");
  return ids
    ? {
        layer,
        objectIndex: ids.getX(face.a),
        distance: hit.distance,
        raycaster: pickRaycaster,
      }
    : null;
}

const alongRaycaster = new Raycaster();

/**
 * Every building tree a pick ray passes through within `far` (the ground,
 * where the probe has it; the ray's own reach otherwise), nearest first,
 * one hit per tree (its nearest face): what stands behind the first, for
 * the probe's candidates. A tile without a BVH is built when its box
 * begins before the first hit (it may hold a nearer one), and passed over
 * behind it: what stands behind the first counts only where it is cheap.
 */
export function cityObjectsAlong(
  camera: Camera,
  layers: readonly CityLayer[],
  ndc?: { x: number; y: number },
  far?: number
): { distance: number; layer: CityLayer; objectIndex: number }[] {
  const reach = setPickRay(
    alongRaycaster,
    ndc ? pickAt.set(ndc.x, ndc.y) : SCREEN_CENTER,
    camera
  );
  alongRaycaster.far = Math.min(reach, far ?? reach);
  const out: { distance: number; layer: CityLayer; objectIndex: number }[] = [];
  const seen = new Set<string>();
  let first = Number.POSITIVE_INFINITY;
  for (const { enter, layer } of layersOnRay(
    alongRaycaster.ray,
    alongRaycaster.far,
    layers
  )) {
    if (enter <= first) {
      layer.ensureBvh();
    }
    const ids = layer.mesh.geometry.getAttribute("featureId");
    if (!(layer.hasBvh() && ids)) {
      continue;
    }
    // A building tree is one tile's: its hits come in this tile's order.
    for (const hit of alongRaycaster.intersectObject(layer.mesh, false)) {
      if (!hit.face) {
        continue;
      }
      const objectIndex = ids.getX(hit.face.a);
      const key = `${layer.tile}:${layer.table.root[objectIndex]}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ distance: hit.distance, layer, objectIndex });
        first = Math.min(first, hit.distance);
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

export function countBuildings(layer: CityLayer): number {
  return countLiveBuildings(layer.table.building, (i) => layer.alive[i] === 1);
}
