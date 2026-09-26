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
} from "three";
import {
  type CityObjectTable,
  countBuildings as countLiveBuildings,
  doomedObjects,
  liveTriangles,
  OBJECT_TEXEL_BANDS,
  OBJECT_TEXTURE_WIDTH,
  objectBandRows,
  packObjectTexels,
} from "@/lib/city/city-mesh";
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
  mesh: Mesh;
  table: CityObjectTable;
  tile: string;
}

/** Marker the collision helpers look for on city meshes. */
export interface CityMesh extends Mesh {
  isCityObjectMesh?: boolean;
}

/** The property table as 3DTilesRendererJS exposes it (one row per id). */
interface StructuralMetadataLike {
  getPropertyTableData: (table: number, id: number) => Record<string, unknown>;
  tableAccessors: { count: number }[];
}

const xyz = (v: unknown): number[] => {
  const p = v as { x?: number; y?: number; z?: number } | number[];
  return Array.isArray(p) ? p : [p.x ?? 0, p.y ?? 0, p.z ?? 0];
};

/** Reads the whole property table into typed columns. */
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
    night: new Uint8Array(count),
    roof: new Float32Array(count * 3),
    root: new Uint32Array(count),
    rough: new Float32Array(count),
    source: new Uint8Array(count),
    storeyH: new Float32Array(count),
    tint: new Float32Array(count * 3),
  };
  for (let i = 0; i < count; i++) {
    const row = metadata.getPropertyTableData(0, i);
    table.baseZ[i] = Number(row.baseZ);
    table.building[i] = Number(row.building);
    table.eaveH[i] = Number(row.eaveH);
    table.flags[i] = Number(row.flags);
    table.glow[i] = Number(row.glow);
    // Tiles baked before the column existed read as housing.
    table.night[i] = row.night === undefined ? 1 : Number(row.night);
    table.roof.set(xyz(row.roof), i * 3);
    table.root[i] = Number(row.root);
    table.rough[i] = Number(row.rough);
    // LoD2 (0) or the laser scan's small structures (1); absent before plan 034
    table.source[i] = Number(row.source ?? 0);
    table.storeyH[i] = Number(row.storeyH);
    table.tint.set(xyz(row.tint), i * 3);
  }
  return table;
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
  // Casting works with three's default depth pass; receiving works because
  // the clay material is a lit MeshStandardMaterial.
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
  };
  return layer;
}

// Hoisted: demolish picks happen on a key press, but there's no reason to
// allocate per call. firstHitOnly stops the BVH walk at the nearest hit
// instead of collecting and sorting every intersection along the ray.
const pickRaycaster = new Raycaster();
pickRaycaster.firstHitOnly = true;
const SCREEN_CENTER = new Vector2(0, 0);

/** Raycasts the screen center over `layers`: the nearest aimed object. */
export function pickCityObject(
  camera: Camera,
  layers: readonly CityLayer[]
): { layer: CityLayer; objectIndex: number } | null {
  pickRaycaster.setFromCamera(SCREEN_CENTER, camera);
  const meshes: Object3D[] = layers.map((l) => l.mesh);
  const hit = pickRaycaster.intersectObjects(meshes, false)[0];
  const face = hit?.face;
  const layer = layers.find((l) => l.mesh === hit?.object);
  if (!(face && layer)) {
    return null;
  }
  const ids = layer.mesh.geometry.getAttribute("featureId");
  return ids ? { layer, objectIndex: ids.getX(face.a) } : null;
}

export function countBuildings(layer: CityLayer): number {
  return countLiveBuildings(layer.table.building, (i) => layer.alive[i] === 1);
}
