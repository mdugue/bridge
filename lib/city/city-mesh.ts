import type { FacadeMaterial } from "./building-tint";
import type { FootprintPoly } from "./minimap";
import type { ObjectFacts } from "./object-facts";
import type { CityJsonDocument } from "./types";
import type { WindowSpec } from "./windows";

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

/** The wall materials the clay tells apart (osm_buildings.py normalises
 *  OSM's `building:material` to these). */
export type WallMaterial =
  | "brick"
  | "concrete"
  | "glass"
  | "metal"
  | "plaster"
  | "stone"
  | "wood";

/** What OSM knows about one CityObject. */
export interface OsmBuildingFacts {
  /** its address line, for the inquiry card (ADR 0042) */
  addr?: string;
  /** walls, `#rrggbb` (OSM `building:colour`) */
  colour?: string;
  /** the walls its neighbourhood is mapped as, where they differ from the
   *  tile's (osm_buildings.py `context`) */
  context?: FacadeMaterial;
  heritage?: number;
  /** one of the city's landmarks (landmarks.py, Wikidata) */
  landmark?: number;
  /** `building:levels`, for the inquiry card and the storey bands */
  levels?: number;
  material?: WallMaterial;
  /** the outline's `name`, for the inquiry card */
  name?: string;
  /** roof, `#rrggbb` (OSM `roof:colour`) */
  roof_colour?: string;
  shop?: number;
}

/**
 * What OSM knows about a CityObject, keyed by its id
 * (`pipeline/bake/osm_buildings.py` → `data/<site>/dlm/osmbuild_<tile>.json`).
 */
export type OsmBuildingLut = Record<string, OsmBuildingFacts | undefined>;

/** A shop or a place to eat on the ground floor (column `flags`). */
export const OBJECT_FLAG_SHOP = 1;
/** A listed building, OSM `heritage=*` (column `flags`). */
export const OBJECT_FLAG_HERITAGE = 2;
/** Glass walls (OSM `building:material=glass`): a cool sheen (column `flags`). */
export const OBJECT_FLAG_GLASS = 4;
/** Metal walls or cladding: a cool, smoother clay (column `flags`). */
export const OBJECT_FLAG_METAL = 8;
/** Part of one of the city's landmarks (Wikidata) or of a building whose
 *  facade is its own (`ownFacade`, lib/city/building-tint.ts): no generic
 *  Gliederung, no drawn doors (column `flags`). */
export const OBJECT_FLAG_LANDMARK = 16;
/** The building someone is asking about (the inquiry card, ADR 0042): set
 *  in the packed texture at runtime only, never baked. */
export const OBJECT_FLAG_ASKED = 32;
/** A part that wears its own colour (a door's surround and leaf): its tint
 *  drawn at full strength, not mixed into the clay by *Farbvariation*. */
export const OBJECT_FLAG_OWN_COLOUR = 64;
/** An object that stands on the ground, not on another part's roof: the
 *  plinth, shop zone and ground-floor cornice are drawn on it only. */
export const OBJECT_FLAG_GROUNDED = 128;
/** A flat roof (`markFlatRoofs`: most of its roof area lies flat): a
 *  post-war or modern building, whose facade the clay's Gliederung (a town
 *  house's plinth and cornices) does not dress. The column is 16 bits wide
 *  from this flag on. */
export const OBJECT_FLAG_FLAT_ROOF = 256;
/** A roof triangle within this of level counts as flat (cos 10°). */
const FLAT_NORMAL_Z = 0.985;
/** An object whose roof is flat over this share of its area is flat-roofed:
 *  LoD2 calls many post-war slabs a mixed form (`roofType` 5000) for a
 *  stair tower or a pavilion's lean-to, so the type alone misses them. */
export const FLAT_ROOF_SHARE = 0.75;

/**
 * Sets OBJECT_FLAG_FLAT_ROOF on every object whose roof triangles
 * (`isRoof`, non-indexed, three vertices each) lie flat over
 * `FLAT_ROOF_SHARE` of their area. In place.
 */
export function markFlatRoofs(
  objects: readonly Pick<CityObjectRow, "flags">[],
  mesh: {
    positions: ArrayLike<number>;
    objectIds: ArrayLike<number>;
    isRoof: ArrayLike<number>;
  }
): void {
  const flat = new Float64Array(objects.length);
  const all = new Float64Array(objects.length);
  const p = mesh.positions;
  for (let v = 0; v + 2 < mesh.objectIds.length; v += 3) {
    if (mesh.isRoof[v] < 0.5) {
      continue;
    }
    const [a, b, c] = [v * 3, v * 3 + 3, v * 3 + 6];
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a];
    const wy = p[c + 1] - p[a + 1];
    const wz = p[c + 2] - p[a + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const area = Math.hypot(nx, ny, nz);
    const o = mesh.objectIds[v];
    if (area > 0 && o < objects.length) {
      all[o] += area;
      if (Math.abs(nz) / area >= FLAT_NORMAL_Z) {
        flat[o] += area;
      }
    }
  }
  objects.forEach((o, i) => {
    if (
      all[i] > 0 &&
      flat[i] >= FLAT_ROOF_SHARE * all[i] &&
      !hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF)
    ) {
      o.flags += OBJECT_FLAG_FLAT_ROOF;
    }
  });
}

/** A part counts as grounded when its base lies within this of its building
 *  tree's lowest base (a slope's fall; a part on a roof sits a storey up). */
export const GROUNDED_SLACK_M = 3;

/**
 * Sets OBJECT_FLAG_GROUNDED on every object whose base lies within
 * `GROUNDED_SLACK_M` of the lowest base in its building tree (a lone
 * building is its own tree, so it always does). A Building drawn only by
 * its parts has no geometry (no height, base 0) and takes no part. In
 * place.
 */
export function markGrounded(
  objects: readonly Pick<CityObjectRow, "baseZ" | "eaveH" | "flags" | "root">[]
): void {
  const drawn = objects.filter((o) => o.eaveH > 0);
  const lowest = new Map<number, number>();
  for (const o of drawn) {
    lowest.set(o.root, Math.min(lowest.get(o.root) ?? Infinity, o.baseZ));
  }
  for (const o of drawn) {
    const grounded =
      o.baseZ <= (lowest.get(o.root) ?? o.baseZ) + GROUNDED_SLACK_M;
    if (grounded && !hasObjectFlag(o.flags, OBJECT_FLAG_GROUNDED)) {
      o.flags += OBJECT_FLAG_GROUNDED;
    }
  }
}

/** The `flags` value of one object: its OSM facts summed as bits. */
export function objectFlags(entry?: OsmBuildingFacts): number {
  return (
    (entry?.shop ? OBJECT_FLAG_SHOP : 0) +
    (entry?.heritage ? OBJECT_FLAG_HERITAGE : 0) +
    (entry?.material === "glass" ? OBJECT_FLAG_GLASS : 0) +
    (entry?.material === "metal" ? OBJECT_FLAG_METAL : 0) +
    (entry?.landmark ? OBJECT_FLAG_LANDMARK : 0)
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
  own?: OsmBuildingFacts,
  root?: OsmBuildingFacts
): number {
  return objectFlags({
    shop: (own?.shop ?? 0) + (root?.shop ?? 0),
    heritage: (own?.heritage ?? 0) + (root?.heritage ?? 0),
    landmark: (own?.landmark ?? 0) + (root?.landmark ?? 0),
    material: own?.material ?? root?.material,
  });
}

/** An object's look from OSM, its own facts over its root Building's. */
export function inheritedLook(
  own?: OsmBuildingFacts,
  root?: OsmBuildingFacts
): Pick<OsmBuildingFacts, "colour" | "context" | "material" | "roof_colour"> {
  return {
    colour: own?.colour ?? root?.colour,
    context: own?.context ?? root?.context,
    material: own?.material ?? root?.material,
    roof_colour: own?.roof_colour ?? root?.roof_colour,
  };
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
  /** identity and semantics, the table's fact columns (ADR 0042) */
  facts?: ObjectFacts;
  /** OBJECT_FLAG_* summed, from OSM (0 = none) */
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
  /** the windows the clay draws on its walls (lib/city/windows.ts; none
   *  when absent) */
  windows?: WindowSpec;
}

/** An object of the LoD2 CityJSON (column `source`, the default). */
export const OBJECT_SOURCE_LOD2 = 0;
/** A small structure from the laser scan (pipeline/bake/small_buildings.py). */
export const OBJECT_SOURCE_SCAN = 1;
/** A structure the surface model shows beyond LoD2 (pipeline/bake/
 *  structures.py): a chimney, tower or mast, or a missing building. */
export const OBJECT_SOURCE_GAP = 2;
/** A doorway on a wall, part of the building it opens (pipeline/bake/
 *  doors.py, OSM entrances): its surround or its leaf. */
export const OBJECT_SOURCE_DOOR = 3;
/** A dormer on a pitched roof, part of the building it sits on (pipeline/
 *  bake/dormers.py, the surface model over the LoD2 roof). */
export const OBJECT_SOURCE_DORMER = 4;
/** A shopfront on a ground floor, part of the building it fronts
 *  (pipeline/bake/shopfronts.py: street photos, the surface model's
 *  canopies): its glass, its frame and fascia, or its canopy. (5 is the
 *  plinths'.) */
export const OBJECT_SOURCE_SHOPFRONT = 6;

/** A plinth on a wall's street side, part of the building it carries
 *  (pipeline/bake/plinths.py, LoD2 + DGM1). */
export const OBJECT_SOURCE_PLINTH = 5;

/** The property table as typed columns — how the glTF carries it. */
export interface CityObjectTable {
  baseZ: Float32Array;
  building: Uint8Array;
  count: number;
  eaveH: Float32Array;
  flags: Uint16Array;
  glow: Uint8Array;
  roof: Float32Array;
  root: Uint32Array;
  rough: Float32Array;
  source: Uint8Array;
  storeyH: Float32Array;
  tint: Float32Array;
  /** the windows' axis spacing (0: none), width, height (m) and style
   *  (lib/city/windows.ts `WindowSpec`) */
  winAxis: Float32Array;
  winH: Float32Array;
  winStyle: Uint32Array;
  winW: Float32Array;
}

/** Rows → columns (the bake side). */
export function objectTable(rows: readonly CityObjectRow[]): CityObjectTable {
  const count = rows.length;
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
    table.winAxis[i] = r.windows?.axis ?? 0;
    table.winH[i] = r.windows?.h ?? 0;
    table.winStyle[i] = r.windows?.style ?? 0;
    table.winW[i] = r.windows?.w ?? 0;
  });
  return table;
}

/** Objects per texel row of the packed table (a WebGL2-safe edge). */
export const OBJECT_TEXTURE_WIDTH = 1024;
/** RGBA texels per object: (tint, baseZ) (roof, eaveH) (storeyH, glow,
 *  rough, flags) (window axis, width, height, style). */
export const OBJECT_TEXEL_BANDS = 4;

/** Rows of one band: the texture is `OBJECT_TEXTURE_WIDTH × bandRows·4`. */
export function objectBandRows(count: number): number {
  return Math.max(1, Math.ceil(count / OBJECT_TEXTURE_WIDTH));
}

/**
 * The table as RGBA float texels for the clay shader. Object `i` lives at
 * column `i % W`, row `floor(i / W)` of each of four bands stacked
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
    out.set(
      [table.winAxis[i], table.winW[i], table.winH[i], table.winStyle[i]],
      3 * band + at
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

/**
 * ALKIS "Bauwerk im Verkehrsbereich" (object type 53001: bridges, tunnel
 * mouths, culverts). Saxony's LoD2 carries them as `Building`s with a flat
 * 1 m slab at deck height; the rail layer builds the bridges from the
 * Basis-DLM, DOM1 and OSM, so as clay "houses" they only doubled the decks.
 */
const TRAFFIC_STRUCTURE = "53001_";

/** True for a CityObject the building mesh leaves out. */
export function isTrafficStructure(attributes: unknown): boolean {
  const fn = (attributes as { function?: unknown } | undefined)?.function;
  return typeof fn === "string" && fn.startsWith(TRAFFIC_STRUCTURE);
}

/**
 * The document without its traffic structures (and their parts). The
 * vertex list stays untouched: the loader's recenter matrix is computed
 * over it, and the spawn tile's matrix is the frame every tile shares.
 */
export function withoutTrafficStructures(
  doc: CityJsonDocument
): CityJsonDocument {
  const drop = new Set<string>();
  for (const [id, o] of Object.entries(doc.CityObjects)) {
    if (isTrafficStructure(o.attributes)) {
      drop.add(id);
      for (const child of o.children ?? []) {
        drop.add(child);
      }
    }
  }
  if (drop.size === 0) {
    return doc;
  }
  const CityObjects: CityJsonDocument["CityObjects"] = {};
  for (const [id, o] of Object.entries(doc.CityObjects)) {
    if (!drop.has(id)) {
      CityObjects[id] = o;
    }
  }
  return { ...doc, CityObjects };
}
