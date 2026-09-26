import type { FootprintPoly } from "./minimap";

/**
 * The buildings' per-object table. The bake (scripts/bake-city-mesh.ts)
 * produces one row per CityJSON object; scripts/bake-tiles.ts writes the rows
 * into the building glTF as an EXT_structural_metadata property table (one
 * column per field), with every vertex carrying its object's index as
 * EXT_mesh_features `_FEATURE_ID_0`. The runtime packs the columns into one
 * float texture the clay shader reads per vertex (`packObjectTexels`), so
 * the style lives once per building instead of once per vertex, and
 * demolish is an index filter on the loaded mesh. No THREE, no DOM.
 */

export type Rgb = [number, number, number];

/**
 * What OSM knows about a CityObject, keyed by its id
 * (`pipeline/bake/osm_buildings.py` → `data/<site>/dlm/osmbuild_<tile>.json`).
 */
export type OsmBuildingLut = Record<
  string,
  { heritage?: number; shop?: number } | undefined
>;

/** A shop or a place to eat on the ground floor (column `flags`). */
export const OBJECT_FLAG_SHOP = 1;
/** A listed building, OSM `heritage=*` (column `flags`). */
export const OBJECT_FLAG_HERITAGE = 2;

/** The `flags` value of one object: its OSM facts summed as bits. */
export function objectFlags(entry?: {
  heritage?: number;
  shop?: number;
}): number {
  return (
    (entry?.shop ? OBJECT_FLAG_SHOP : 0) +
    (entry?.heritage ? OBJECT_FLAG_HERITAGE : 0)
  );
}

/**
 * The `flags` of an object with its root Building's: the object's own facts
 * or the root's. osm_buildings.py marks the root of every part it finds a
 * shop or a listing on, and a Saxon LoD2 Building with parts has no
 * geometry of its own — so its flags show only through its parts (like its
 * attributes, `inheritedAttributes`).
 */
export function inheritedFlags(
  own?: { heritage?: number; shop?: number },
  root?: { heritage?: number; shop?: number }
): number {
  return objectFlags({
    shop: (own?.shop ?? 0) + (root?.shop ?? 0),
    heritage: (own?.heritage ?? 0) + (root?.heritage ?? 0),
  });
}

/** Whether `flags` carries `bit` (one of the OBJECT_FLAG_* powers of two). */
export function hasObjectFlag(flags: number, bit: number): boolean {
  return Math.floor(flags / bit) % 2 === 1;
}

/** One CityJSON object as the bake describes it. */
export interface CityObjectRow {
  /** lowest vertex elevation (m, data-frame Z) — the building's own base */
  baseZ: number;
  /** true for CityObjects of type Building (the HUD counts these) */
  building: boolean;
  /** eave height above the base (m): lowest RoofSurface vertex, else the top */
  eaveH: number;
  /** OBJECT_FLAG_SHOP + OBJECT_FLAG_HERITAGE, from OSM (0 = neither) */
  flags: number;
  /** GroundSurface footprints (EPSG), for the minimap */
  footprints: [number, number][][];
  /** 1 = warm dusk glow (commerce/public/special), 0 = housing */
  glow: 0 | 1;
  /** roof colour (linear RGB): DOP-sampled when available, else synthesized */
  roof: Rgb;
  /** index of the root of this object's building tree (itself for a root) */
  root: number;
  /** signed roughness jitter [-1, 1] */
  rough: number;
  /** where the object comes from (column `source`): OBJECT_SOURCE_* */
  source?: number;
  /** storey height (m) for the contour bands */
  storeyH: number;
  /** wall colour (linear RGB) */
  tint: Rgb;
}

/** An object of the LoD2 CityJSON (column `source`, the default). */
export const OBJECT_SOURCE_LOD2 = 0;
/** A small structure from the laser scan (pipeline/bake/small_buildings.py). */
export const OBJECT_SOURCE_SCAN = 1;

/** The property table as typed columns — how the glTF carries it. */
export interface CityObjectTable {
  baseZ: Float32Array;
  building: Uint8Array;
  count: number;
  eaveH: Float32Array;
  flags: Uint8Array;
  glow: Uint8Array;
  roof: Float32Array;
  root: Uint32Array;
  rough: Float32Array;
  source: Uint8Array;
  storeyH: Float32Array;
  tint: Float32Array;
}

/** Rows → columns (the bake side). */
export function objectTable(rows: readonly CityObjectRow[]): CityObjectTable {
  const count = rows.length;
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
  rows.forEach((r, i) => {
    table.baseZ[i] = r.baseZ;
    table.building[i] = r.building ? 1 : 0;
    table.eaveH[i] = r.eaveH;
    table.flags[i] = r.flags;
    table.glow[i] = r.glow;
    table.roof.set(r.roof, i * 3);
    table.root[i] = r.root;
    table.rough[i] = r.rough;
    table.source[i] = r.source ?? OBJECT_SOURCE_LOD2;
    table.storeyH[i] = r.storeyH;
    table.tint.set(r.tint, i * 3);
  });
  return table;
}

/** Objects per texel row of the packed table (a WebGL2-safe edge). */
export const OBJECT_TEXTURE_WIDTH = 1024;
/** RGBA texels per object: (tint, baseZ) (roof, eaveH) (storeyH, glow, rough, flags). */
export const OBJECT_TEXEL_BANDS = 3;

/** Rows of one band: the texture is `OBJECT_TEXTURE_WIDTH × bandRows·3`. */
export function objectBandRows(count: number): number {
  return Math.max(1, Math.ceil(count / OBJECT_TEXTURE_WIDTH));
}

/**
 * The table as RGBA float texels for the clay shader. Object `i` lives at
 * column `i % W`, row `floor(i / W)` of each of three bands stacked
 * vertically; the shader reads band `b` at row `+ b · bandRows`.
 */
export function packObjectTexels(table: CityObjectTable): Float32Array {
  const rows = objectBandRows(table.count);
  const band = OBJECT_TEXTURE_WIDTH * rows * 4;
  const out = new Float32Array(band * OBJECT_TEXEL_BANDS);
  for (let i = 0; i < table.count; i++) {
    const at = i * 4;
    out.set([...table.tint.subarray(i * 3, i * 3 + 3), table.baseZ[i]], at);
    out.set(
      [...table.roof.subarray(i * 3, i * 3 + 3), table.eaveH[i]],
      band + at
    );
    out.set(
      [table.storeyH[i], table.glow[i], table.rough[i], table.flags[i]],
      2 * band + at
    );
  }
  return out;
}

/**
 * Demolition on the data level: the object's whole building tree. In this
 * dataset many Buildings carry no geometry themselves — their BuildingParts
 * do — so picking a part must take the root and every sibling with it.
 */
export function doomedObjects(
  root: ArrayLike<number>,
  objectIndex: number
): Set<number> {
  const doomed = new Set<number>();
  if (objectIndex < 0 || objectIndex >= root.length) {
    return doomed;
  }
  const tree = root[objectIndex];
  for (let i = 0; i < root.length; i++) {
    if (root[i] === tree) {
      doomed.add(i);
    }
  }
  return doomed;
}

/**
 * Triangle indices without the triangles of dead objects (a triangle belongs
 * to the object of its first vertex; the bake never shares a vertex between
 * objects).
 */
export function liveTriangles(
  index: ArrayLike<number>,
  featureIds: ArrayLike<number>,
  alive: (objectIndex: number) => boolean
): Uint32Array {
  const out = new Uint32Array(index.length);
  let n = 0;
  for (let t = 0; t < index.length; t += 3) {
    if (alive(featureIds[index[t]])) {
      out[n++] = index[t];
      out[n++] = index[t + 1];
      out[n++] = index[t + 2];
    }
  }
  return out.slice(0, n);
}

/** Number of live objects of type Building. */
export function countBuildings(
  building: ArrayLike<number>,
  alive: (objectIndex: number) => boolean
): number {
  let count = 0;
  for (let i = 0; i < building.length; i++) {
    if (building[i] === 1 && alive(i)) {
      count++;
    }
  }
  return count;
}

/** Footprint polygons of the live objects. */
export function footprintPolys(
  footprints: readonly [number, number][][][],
  alive: (objectIndex: number) => boolean
): FootprintPoly[] {
  const out: FootprintPoly[] = [];
  footprints.forEach((polys, i) => {
    if (alive(i)) {
      for (const pts of polys) {
        out.push({ pts });
      }
    }
  });
  return out;
}
