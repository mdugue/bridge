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
  type Object3D,
  type Ray,
  RGBAFormat,
  Raycaster,
  Vector2,
} from "three/webgpu";
import { buildBvhOffThread, bvhBuilding, bvhLost } from "./bvh-client";
import { rayEntry } from "./collision";
import { streamTimings } from "./stream-timing";
import { setPickRay } from "./view-ray";
import {
  type CityObjectTable,
  countBuildings as countLiveBuildings,
  shaderFlags,
  doomedObjects,
  liveTriangles,
  OBJECT_TEXEL_BANDS,
  OBJECT_TEXTURE_WIDTH,
  OBJECT_SOURCE_DORMER,
  objectBandRows,
  packObjectTexels,
} from "@/lib/city/city-mesh";
import {
  appendTriangles,
  takeTriangles,
  wholeTrees,
} from "@/lib/city/hidden-triangles";
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
  /**
   * The objects a loaded design stands in for (design-layer.ts, ADR
   * 0054): their triangles leave the index as a demolish's do, and come
   * back when they leave the set — kept aside meanwhile, not reparsed.
   * True when anything changed.
   */
  setHidden: (objects: ReadonlySet<number>) => boolean;
  dispose: () => void;
  /** what street photos say about the tile's facades, once they land
   *  (lib/city/facade-reading.ts) */
  facadeReadings: (readings: FacadeReadings) => void;
  /** what the twin knows about one object (read from the table on demand) */
  facts: (objectIndex: number) => ObjectFacts;
  /** whether the tile's BVH is built (`ensureCityBvh`) — not while the
   *  worker builds it (`prepareBvh`) */
  hasBvh: () => boolean;
  /** builds the tile's BVH here and now unless it has one or the worker
   *  is building it (a long task: ≈0.2 s for a dense tile on a desktop,
   *  0.8–1.6 s on the phone profile) */
  ensureBvh: () => void;
  /** builds the tile's BVH in the BVH worker (bvh-client.ts): what the
   *  tiles near the camera get ahead of a ray; settles once it is built */
  prepareBvh: () => Promise<void>;
  /** the index a demolish or a design's hiding set is on the GPU now (a
   *  compile of the mesh, create-app.ts): until then the worker may not
   *  take it — handed over before its upload, its buffer is gone when the
   *  renderer first copies it. `index`: the one the compile drew (a
   *  newer one set meanwhile stays fresh) */
  indexUploaded: (index: BufferAttribute | null) => void;
  /** a demolish the worker's build holds back, settling once it has
   *  reached the index (null: none waits) — the shadows are drawn again then */
  held: () => Promise<void> | null;
  /** marks the objects someone asks about (the clay's pencil hatch); an
   *  empty set clears the mark */
  mark: (objects: ReadonlySet<number>) => void;
  /**
   * Hangs something drawn beside the mesh on a building (a mural,
   * mural-layer.ts): it is shown while all of the building is — gone with
   * a demolish of any of its parts, and while a design stands in for one.
   * `buildingId` is the building's LoD2 id (`buildingId` in the table,
   * every part's alike); one the tile does not hold is shown always.
   */
  hang: (object: Object3D, buildingId: string) => void;
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
    ensemble: new Uint32Array(count),
    flags: new Uint16Array(count),
    group: new Uint32Array(count),
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
  // absent columns stay 0 (`source` before plan 034: LoD2)
  const scalar = (
    name: string,
    out: Float32Array | Uint8Array | Uint16Array | Uint32Array
  ) => accessor?.readColumn(name, out);
  scalar("baseZ", table.baseZ);
  scalar("building", table.building);
  scalar("eaveH", table.eaveH);
  scalar("flags", table.flags);
  scalar("glow", table.glow);
  scalar("root", table.root);
  // a tile baked before the ensembles: each tree is its own
  table.ensemble.set(table.root);
  scalar("ensemble", table.ensemble);
  scalar("group", table.group);
  scalar("rough", table.rough);
  scalar("source", table.source);
  scalar("storeyH", table.storeyH);
  // a tile baked before the windows has none (absent columns stay 0)
  scalar("winAxis", table.winAxis);
  scalar("winH", table.winH);
  scalar("winStyle", table.winStyle);
  scalar("winW", table.winW);
  scalar("roof", table.roof);
  scalar("tint", table.tint);
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
    const want = shaderFlags(table, i, marked.has(i));
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
  // (none while the worker has its positions and index: bvh-client.ts)
  if (!(mesh.geometry.boundsTree || bvhBuilding(mesh.geometry))) {
    streamTimings.timedSync(
      "tile:bvh",
      () => mesh.geometry.computeBoundsTree(),
      mesh.name
    );
  }
}

/**
 * Whether what hangs on a building (CityLayer.hang) shows: while every
 * object of it stands — none demolished (`alive`), none a design stands in
 * for (`hidden`). One whose building the tile does not hold (no objects)
 * always shows.
 */
export function hangsShown(
  objects: readonly number[],
  alive: Uint8Array,
  hidden: ReadonlySet<number>
): boolean {
  return objects.every((i) => alive[i] === 1 && !hidden.has(i));
}

/**
 * Dresses a streamed city mesh: the glTF feature id and place on the wall
 * (the windows', a roof vertex flagged in it) under the names the clay
 * shader reads, the tile's clay material; its BVH comes when a ray needs
 * it (`ensureCityBvh`). `demolished` replays this session's demolitions of
 * the tile, `demolishedGroups` those of ensembles across a tile edge (a
 * part demolished while this tile was not loaded).
 */
export function dressCity(
  mesh: Mesh,
  tile: string,
  resources: StyleResources,
  demolished: ReadonlySet<number>,
  demolishedGroups: ReadonlySet<number> = new Set()
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
  /** an index set here that the GPU may not have yet (`indexUploaded`) */
  let fresh = false;
  const featureIds = geometry.getAttribute("featureId");
  /** `again`: a BVH there was is built again now (else when a ray or the
   *  worker gets to it) */
  const rebuild = (again = true) => {
    const index = geometry.getIndex();
    if (!index) {
      return;
    }
    const had = again && Boolean(geometry.boundsTree);
    geometry.setIndex(
      new BufferAttribute(
        liveTriangles(index.array, featureIds.array, (i) => alive[i] === 1),
        1
      )
    );
    fresh = true;
    // A BVH is built over its index: a new index needs a new one — now
    // where there was one (a demolish picks through it), else when a ray
    // needs it.
    geometry.disposeBoundsTree();
    if (had) {
      geometry.computeBoundsTree();
    }
  };
  /** what a design hides (wanted), what is out of the index now, and
   *  the triangles kept aside */
  let hidden: ReadonlySet<number> = new Set();
  const applied = new Set<number>();
  const stashed = new Map<number, Uint32Array>();
  /** brings the index to `hidden`: triangles aside and back; `again` as
   *  `rebuild`'s */
  const applyHidden = (again = true) => {
    const index = geometry.getIndex();
    const hide = new Set([...hidden].filter((i) => !applied.has(i)));
    const show = [...applied].filter((i) => !hidden.has(i));
    if (!index || (hide.size === 0 && show.length === 0)) {
      return;
    }
    const had = again && Boolean(geometry.boundsTree);
    const { kept, taken } = takeTriangles(index.array, featureIds.array, (i) =>
      hide.has(i)
    );
    for (const [object, list] of taken) {
      stashed.set(object, list);
    }
    for (const object of hide) {
      applied.add(object);
    }
    const back: Uint32Array[] = [];
    for (const object of show) {
      applied.delete(object);
      const list = stashed.get(object);
      stashed.delete(object);
      // (an object demolished while hidden stays gone)
      if (list && alive[object] === 1) {
        back.push(list);
      }
    }
    geometry.setIndex(new BufferAttribute(appendTriangles(kept, back), 1));
    fresh = true;
    geometry.disposeBoundsTree();
    if (had) {
      geometry.computeBoundsTree();
    }
  };
  let dead = demolished.size;
  for (const i of demolished) {
    alive[i] = 0;
  }
  if (demolishedGroups.size > 0) {
    for (let i = 0; i < count; i++) {
      if (alive[i] === 1 && demolishedGroups.has(table.group[i])) {
        alive[i] = 0;
        dead++;
      }
    }
  }
  if (dead > 0) {
    rebuild();
  }

  /** the worker's build of the BVH, while it runs */
  let prepared: Promise<void> | null = null;
  /** a demolish or a design's hiding waiting for that build to give the
   *  index back */
  let held: Promise<void> | null = null;
  let demolishWaits = false;
  let disposed = false;
  /** what waited on the worker, once it is done */
  const settle = () => {
    if (disposed) {
      return;
    }
    if (demolishWaits) {
      demolishWaits = false;
      rebuild(false);
    }
    applyHidden(false);
  };
  // the asked objects, kept for the facade readings' repack
  let marked: ReadonlySet<number> = new Set();
  /** what hangs on a building (`hang`): shown while its objects are */
  const hangers: { at: number[]; object: Object3D }[] = [];
  const showHangers = () => {
    for (const { at, object } of hangers) {
      object.visible = hangsShown(at, alive, hidden);
    }
  };
  const layer: CityLayer = {
    tile,
    mesh,
    table,
    tableBytes:
      typedBytes(table) +
      (objects.texture.image.data as Float32Array).byteLength,
    alive,
    demolish: (objectIndex) => {
      const doomed = doomedObjects(table.ensemble, objectIndex);
      // (a tile a dead worker kept the index of has none to rebuild from)
      if (doomed.size === 0 || bvhLost(geometry)) {
        return false;
      }
      for (const i of doomed) {
        alive[i] = 0;
      }
      showHangers();
      // the index is the worker's while it builds the BVH: rebuilt after
      // (unless the tile has left by then), its BVH left to the worker
      // again rather than built here in the frame
      if (prepared) {
        demolishWaits = true;
        held ??= prepared.then(settle, settle).finally(() => {
          held = null;
        });
      } else {
        rebuild();
      }
      return true;
    },
    setHidden: (asked) => {
      // a covered house goes with what hangs on it (its plinth, cornices,
      // doors, parts): they have no footprint of their own
      const next = wholeTrees(table.root, asked);
      const same =
        next.size === hidden.size && [...next].every((i) => hidden.has(i));
      if (same || bvhLost(geometry)) {
        return false;
      }
      hidden = new Set(next);
      showHangers();
      // the index is the worker's while it builds the BVH: as a demolish
      if (prepared) {
        held ??= prepared.then(settle, settle).finally(() => {
          held = null;
        });
      } else {
        // the BVH built again in the worker once the new index is on the
        // GPU (`indexUploaded`), not here in the frame: a design moved by
        // hand re-hides on every settle (ADR 0024)
        applyHidden(false);
      }
      return true;
    },
    dispose: () => {
      disposed = true;
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
          readings,
          (i) => table.source[i] === OBJECT_SOURCE_DORMER
        ) &&
        markObjects(objects.texture, table, marked)
      ) {
        objects.texture.needsUpdate = true;
      }
    },
    facts: (objectIndex) => readObjectFacts(metadata, objectIndex),
    hasBvh: () => Boolean(geometry.boundsTree),
    ensureBvh: () => ensureCityBvh(mesh),
    held: () => held,
    indexUploaded: (uploaded) => {
      if (uploaded !== null && uploaded === geometry.getIndex()) {
        fresh = false;
      }
    },
    prepareBvh: () => {
      if (fresh) {
        return Promise.resolve();
      }
      prepared ??= streamTimings
        .timed(
          "tile:bvh-worker",
          () => buildBvhOffThread(geometry, () => !disposed),
          tile
        )
        .finally(() => {
          prepared = null;
        });
      return prepared;
    },
    hang: (object, buildingId) => {
      const ids = metadata.tableAccessors[0];
      const at: number[] = [];
      if (ids && "buildingId" in ids.properties) {
        for (let i = 0; i < count; i++) {
          if (String(ids.getPropertyValue("buildingId", i)) === buildingId) {
            at.push(i);
          }
        }
      }
      hangers.push({ at, object });
      showHangers();
    },
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
 * back to on a mesh without one. Where `build`, a tile whose BVH the worker
 * builds that could hold the nearest hit makes it none (null): a pick then
 * does nothing rather than ask the building behind.
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
    // a tile the worker has may hold the nearest hit: no answer until it
    // is back (asked anyway, the building behind it would answer)
    if (build && bvhBuilding(layer.mesh.geometry)) {
      return null;
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
    if (layer.hasBvh() || bvhBuilding(layer.mesh.geometry)) {
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
      // as in `nearestCityHit`: a tile the worker has may hold the first
      if (bvhBuilding(layer.mesh.geometry)) {
        return [];
      }
      layer.ensureBvh();
    }
    const ids = layer.mesh.geometry.getAttribute("featureId");
    if (!(layer.hasBvh() && ids)) {
      continue;
    }
    // An ensemble is one tile's: its hits come in this tile's order.
    for (const hit of alongRaycaster.intersectObject(layer.mesh, false)) {
      if (!hit.face) {
        continue;
      }
      const objectIndex = ids.getX(hit.face.a);
      const key = buildingKey(layer, objectIndex);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ distance: hit.distance, layer, objectIndex });
        first = Math.min(first, hit.distance);
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * What a building is, across the site: its ensemble's group where it has
 * one (a building a tile edge cuts in two is one), else its tile's
 * ensemble — the key the probe's candidates and votes go by.
 */
export function buildingKey(layer: CityLayer, objectIndex: number): string {
  const group = layer.table.group[objectIndex];
  return group
    ? `g${group}`
    : `${layer.tile}:${layer.table.ensemble[objectIndex]}`;
}

/** The live objects of a layer that belong to a group (none for 0). */
export function groupObjects(layer: CityLayer, group: number): Set<number> {
  const out = new Set<number>();
  if (group === 0) {
    return out;
  }
  for (let i = 0; i < layer.table.count; i++) {
    if (layer.table.group[i] === group && layer.alive[i] === 1) {
      out.add(i);
    }
  }
  return out;
}

export function countBuildings(layer: CityLayer): number {
  return countLiveBuildings(layer.table.building, (i) => layer.alive[i] === 1);
}
