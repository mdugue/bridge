import {
  BufferAttribute,
  type Camera,
  DataTexture,
  FloatType,
  type Mesh,
  NearestFilter,
  type Object3D,
  RGBAFormat,
  Raycaster,
  Vector2,
} from "three/webgpu";
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
import { textureBytes, trackTexture } from "./three-utils";
import { createClayMaterial, type StyleResources } from "./visual-style";

/**
 * One tile's buildings: the streamed glTF mesh (scripts/bake-tiles.ts), its
 * per-object table (EXT_structural_metadata, read by 3DTilesRendererJS) as a
 * float texture the clay shader reads per vertex, and the demolish state.
 * Demolish filters the index buffer — no re-parse, no vertex copies.
 */
export interface CityLayer {
  /** false for objects demolished this session */
  alive: Uint8Array;
  /** drops the object's building tree; true when anything changed */
  demolish: (objectIndex: number) => boolean;
  dispose: () => void;
  /** what the twin knows about one object (read from the table on demand) */
  facts: (objectIndex: number) => ObjectFacts;
  /** marks the objects someone asks about (the clay's pencil hatch); an
   *  empty set clears the mark */
  mark: (objects: ReadonlySet<number>) => void;
  mesh: Mesh;
  table: CityObjectTable;
  tile: string;
}

/** Marker the collision helpers look for on city meshes. */
export interface CityMesh extends Mesh {
  isCityObjectMesh?: boolean;
}

/** One property table as 3DTilesRendererJS exposes it. */
interface PropertyTableLike {
  count: number;
  getPropertyValue: (name: string, id: number) => unknown;
  /** the class's properties (a column the tile lacks is absent here) */
  properties: Record<string, unknown>;
}

/** The glTF's EXT_structural_metadata as 3DTilesRendererJS exposes it. */
interface StructuralMetadataLike {
  tableAccessors: PropertyTableLike[];
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
  metadata: StructuralMetadataLike,
  count: number
): CityObjectTable {
  const table: CityObjectTable = {
    count,
    baseZ: new Float32Array(count),
    building: new Uint8Array(count),
    eaveH: new Float32Array(count),
    flags: new Uint8Array(count),
    glow: new Uint8Array(count),
    roof: new Float32Array(count * 3),
    root: new Uint32Array(count),
    rough: new Float32Array(count),
    source: new Uint8Array(count),
    storeyH: new Float32Array(count),
    tint: new Float32Array(count * 3),
  };
  const accessor = metadata.tableAccessors[0];
  const scalar = (
    name: string,
    out: Float32Array | Uint8Array | Uint32Array
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
  vec3("roof", table.roof);
  vec3("tint", table.tint);
  return table;
}

/** One object's facts from the tile's table (ADR 0037); a tile baked before
 *  the fact columns answers with unknowns and its feature index. */
function readObjectFacts(
  metadata: StructuralMetadataLike,
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
 * Dresses a streamed city mesh: the glTF feature id and roof flag under the
 * names the clay shader reads, the tile's clay material, a BVH for collision
 * and picks. `demolished` replays this session's demolitions of the tile.
 */
export function dressCity(
  mesh: Mesh,
  tile: string,
  resources: StyleResources,
  demolished: ReadonlySet<number>
): CityLayer {
  const geometry = mesh.geometry;
  const metadata = mesh.userData.structuralMetadata as StructuralMetadataLike;
  const count = metadata.tableAccessors[0]?.count ?? 0;
  for (const [from, to] of [
    ["_feature_id_0", "featureId"],
    ["_roof", "roof"],
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
    geometry.setIndex(
      new BufferAttribute(
        liveTriangles(index.array, featureIds.array, (i) => alive[i] === 1),
        1
      )
    );
    geometry.disposeBoundsTree();
    // BVHs make per-frame collision rays (and demolish picks) cheap.
    geometry.computeBoundsTree();
  };
  for (const i of demolished) {
    alive[i] = 0;
  }
  if (demolished.size > 0) {
    rebuild();
  } else {
    geometry.computeBoundsTree();
  }

  const layer: CityLayer = {
    tile,
    mesh,
    table,
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
    facts: (objectIndex) => readObjectFacts(metadata, objectIndex),
    mark: (marked) => {
      if (markObjects(objects.texture, table, marked)) {
        objects.texture.needsUpdate = true;
      }
    },
  };
  return layer;
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
 * object hit and how far along the ray. `raycaster` is left set to the ray,
 * so a caller can test the ground along it.
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
  pickRaycaster.setFromCamera(
    ndc ? pickAt.set(ndc.x, ndc.y) : SCREEN_CENTER,
    camera
  );
  const meshes: Object3D[] = layers.map((l) => l.mesh);
  const hit = pickRaycaster.intersectObjects(meshes, false)[0];
  const face = hit?.face;
  const layer = layers.find((l) => l.mesh === hit?.object);
  if (!(face && layer)) {
    return null;
  }
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

export function countBuildings(layer: CityLayer): number {
  return countLiveBuildings(layer.table.building, (i) => layer.alive[i] === 1);
}
