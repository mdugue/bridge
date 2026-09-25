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

/** One CityJSON object as the bake describes it. */
export interface CityObjectRow {
  /** lowest vertex elevation (m, data-frame Z) — the building's own base */
  baseZ: number;
  /** true for CityObjects of type Building (the HUD counts these) */
  building: boolean;
  /** eave height above the base (m): lowest RoofSurface vertex, else the top */
  eaveH: number;
  /** GroundSurface footprints (EPSG), for the minimap */
  footprints: [number, number][][];
  /** 1 = warm dusk glow (commerce/public/special), 0 = housing */
  glow: 0 | 1;
  /** how the building is lit at night (building-tint.ts `NightLight`, 0..3) */
  night: number;
  /** roof colour (linear RGB): DOP-sampled when available, else synthesized */
  roof: Rgb;
  /** index of the root of this object's building tree (itself for a root) */
  root: number;
  /** signed roughness jitter [-1, 1] */
  rough: number;
  /** storey height (m) for the contour bands */
  storeyH: number;
  /** wall colour (linear RGB) */
  tint: Rgb;
}

/** The property table as typed columns — how the glTF carries it. */
export interface CityObjectTable {
  baseZ: Float32Array;
  building: Uint8Array;
  count: number;
  eaveH: Float32Array;
  glow: Uint8Array;
  night: Uint8Array;
  roof: Float32Array;
  root: Uint32Array;
  rough: Float32Array;
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
    glow: new Uint8Array(count),
    night: new Uint8Array(count),
    roof: new Float32Array(count * 3),
    root: new Uint32Array(count),
    rough: new Float32Array(count),
    storeyH: new Float32Array(count),
    tint: new Float32Array(count * 3),
  };
  rows.forEach((r, i) => {
    table.baseZ[i] = r.baseZ;
    table.building[i] = r.building ? 1 : 0;
    table.eaveH[i] = r.eaveH;
    table.glow[i] = r.glow;
    table.night[i] = r.night;
    table.roof.set(r.roof, i * 3);
    table.root[i] = r.root;
    table.rough[i] = r.rough;
    table.storeyH[i] = r.storeyH;
    table.tint.set(r.tint, i * 3);
  });
  return table;
}

/** Objects per texel row of the packed table (a WebGL2-safe edge). */
export const OBJECT_TEXTURE_WIDTH = 1024;
/** RGBA texels per object: (tint, baseZ) (roof, eaveH) (storeyH, glow, rough, night). */
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
      [table.storeyH[i], table.glow[i], table.rough[i], table.night[i]],
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
