/**
 * Parses one tile's CityJSON into the building mesh the viewer streams (as
 * glTF, scripts/bake-tiles.ts): runs cityjson-threejs-loader once, then
 * folds in everything the clay style needs per building (tints, roof colour
 * incl. the DOP LUT, storey/eave heights, dusk glow, roughness jitter), the
 * OSM flags (shop, heritage; a part carries its Building's too), the
 * demolish tree and the minimap footprints, then appends the small
 * structures the laser scan saw and LoD2 lacks (`appendScanStructures`).
 * Called by scripts/prepare-data.ts; no DOM.
 */
import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import {
  type BufferGeometry,
  type Matrix4,
  type Mesh,
  ShapeUtils,
  Vector2,
} from "three";
import {
  buildingGlows,
  buildingTint,
  type FacadeMaterial,
  inheritedAttributes,
  type RoofColorLut,
  roofColor,
  roofTint,
  roughJitter,
  storeyHeight,
} from "../lib/city/building-tint";
import {
  type CityObjectRow,
  inheritedFlags,
  inheritedLook,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_SCAN,
  type OsmBuildingLut,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import { epsgCodeFromReferenceSystem } from "../lib/city/crs";
import type {
  SmallBuildingFeature,
  StructureFeature,
} from "../lib/city/features";
import { buildingFootprintPolys } from "../lib/city/minimap";
import { recenterOffset } from "../lib/city/recenter";
import {
  SMALL_BUILDING_SINK,
  structureCorners,
  structureMesh,
} from "../lib/city/small-buildings";
import {
  STRUCTURE_SINK,
  structureFootprint,
  structureShape,
} from "../lib/city/structures";
import type { CityJsonDocument } from "../lib/city/types";

/** RoofSurface index in the loader's fixed `defaultSemanticsColors` order. */
const ROOF_SURFACE_TYPE = 2;

/** Trims JSON noise: colours to 3 decimals, metres to centimetres. */
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const cm = (x: number) => Math.round(x * 100) / 100;
const rgb = (c: [number, number, number]): [number, number, number] => [
  r3(c[0]),
  r3(c[1]),
  r3(c[2]),
];

/** The mesh as non-indexed triangles, flat per-face vertices. */
export interface CityVertices {
  /** 1 on RoofSurface vertices, 0 elsewhere */
  isRoof: Float32Array<ArrayBuffer>;
  /** index into the object table */
  objectIds: Float32Array<ArrayBuffer>;
  /** recentered data-frame (Z-up) positions, 3 per vertex */
  positions: Float32Array<ArrayBuffer>;
}

/** Concatenates the loader's chunk meshes into one vertex stream. */
function collectVertices(loaderScene: {
  traverse: (cb: (o: unknown) => void) => void;
}): CityVertices {
  const chunks: {
    objectid: ArrayLike<number>;
    position: ArrayLike<number>;
    surfacetype: ArrayLike<number> | undefined;
  }[] = [];
  loaderScene.traverse((o) => {
    const geom = (o as Mesh).geometry as BufferGeometry | undefined;
    if (!(geom?.attributes.position && geom.attributes.objectid)) {
      return;
    }
    chunks.push({
      position: geom.attributes.position.array,
      objectid: geom.attributes.objectid.array,
      surfacetype: geom.attributes.surfacetype?.array,
    });
  });
  const n = chunks.reduce((s, c) => s + c.objectid.length, 0);
  const out = {
    positions: new Float32Array(n * 3),
    objectIds: new Float32Array(n),
    isRoof: new Float32Array(n),
  };
  let at = 0;
  for (const c of chunks) {
    const count = c.objectid.length;
    for (let i = 0; i < count; i++) {
      out.positions[(at + i) * 3] = c.position[i * 3];
      out.positions[(at + i) * 3 + 1] = c.position[i * 3 + 1];
      out.positions[(at + i) * 3 + 2] = c.position[i * 3 + 2];
      out.objectIds[at + i] = c.objectid[i];
      const surface = c.surfacetype ? c.surfacetype[i] : -1;
      out.isRoof[at + i] = surface === ROOF_SURFACE_TYPE ? 1 : 0;
    }
    at += count;
  }
  return out;
}

/** Climbs `parents` to the root of an object's building tree (cycle-guarded). */
function rootOf(doc: CityJsonDocument, keys: string[], index: number): number {
  let id = keys[index];
  const visited = new Set<string>();
  while (!visited.has(id)) {
    visited.add(id);
    const parent = doc.CityObjects[id]?.parents?.[0];
    if (!(parent && doc.CityObjects[parent])) {
      break;
    }
    id = parent;
  }
  const root = keys.indexOf(id);
  return root === -1 ? index : root;
}

export interface BakedCityMesh {
  epsg: number;
  /** the recenter matrix, to be shared with the block's other tiles */
  matrix: Matrix4;
  objects: CityObjectRow[];
  /** recenter offset: mesh x = epsgX − cx, mesh y = epsgY − cy (Z-up) */
  offset: { cx: number; cy: number };
  vertices: CityVertices;
}

/**
 * The laser scan's small structures (pipeline/bake/small_buildings.py)
 * appended to a parsed tile: one object each at `objects.length + j`, its
 * own root (demolish takes it alone), a Building (the HUD counts it), the
 * hashed wall tint, a calm slate roof (the flat-roof palette — no DOP colour
 * is sampled for them) and `source` 1. Its triangles carry its own id, so
 * the weld never merges across objects. The tint hashes its first corner
 * (rounded to the decimetre), not its index, so a changed LoD2 object count
 * leaves every shed its colour; no storey band (the stroke would fall 0.2 m
 * under the eave, the sink's depth, on nearly every shed).
 */
export function appendScanStructures(
  tile: string,
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  features: readonly SmallBuildingFeature[]
): void {
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  for (const f of features) {
    const box = structureMesh(f, baked.offset);
    const corners = structureCorners(f);
    const z = f.properties?.z;
    if (box.positions.length === 0 || !corners || z === undefined) {
      continue;
    }
    const index = baked.objects.length;
    const id = scanStructureId(tile, f);
    const eave = Math.min(...corners.map((c) => c.h));
    positions.push(...box.positions);
    isRoof.push(...box.isRoof);
    objectIds.push(...box.isRoof.map(() => index));
    baked.objects.push({
      building: true,
      root: index,
      baseZ: cm(z - SMALL_BUILDING_SINK),
      eaveH: cm(eave + SMALL_BUILDING_SINK),
      flags: 0,
      // one band above the eave: none on the box
      storeyH: cm(eave + SMALL_BUILDING_SINK + 1),
      glow: 0,
      rough: r3(roughJitter(id)),
      tint: rgb(buildingTint(id)),
      roof: rgb(roofTint(id, { roofType: "1000" })),
      source: OBJECT_SOURCE_SCAN,
      footprints: [corners.map((c): [number, number] => [cm(c.x), cm(c.y)])],
    });
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(v.isRoof, isRoof),
  };
}

/**
 * The structures the surface model shows beyond LoD2 (pipeline/bake/
 * structures.py) appended like the scan's: one object each, its own root,
 * `source` 2. A column is no Building (the HUD does not count a chimney as
 * a house); a missing building is. Chimneys, towers and lighthouses take
 * the brick palette, masts and the rest the site's walls; a column's head
 * reads as roof, so the roof tint is the wall's own (no terracotta cap on a
 * chimney).
 */
export function appendGapStructures(
  tile: string,
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  features: readonly StructureFeature[],
  facades: FacadeMaterial = "render",
  /** the LoD2 object ids by row, for a relief slab's host */
  objectIndex: ReadonlyMap<string, number> = new Map()
): void {
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  for (const f of features) {
    const p = f.properties;
    const mesh = structureShape(f, baked.offset, triangulateXY);
    if (!p || mesh.positions.length === 0) {
      continue;
    }
    const index = baked.objects.length;
    const hostIndex = p.of === undefined ? undefined : objectIndex.get(p.of);
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (p.kind === "relief" && !host) {
      continue;
    }
    positions.push(...mesh.positions);
    isRoof.push(...mesh.isRoof);
    objectIds.push(...mesh.isRoof.map(() => index));
    if (host) {
      // a relief slab is part of its landmark: its look, its building tree
      // (demolish takes it along), no footprint of its own, no storey bands
      baked.objects.push({
        ...host,
        building: false,
        baseZ: cm(p.z),
        eaveH: cm(p.h),
        storeyH: cm(p.h + 1),
        source: OBJECT_SOURCE_GAP,
        footprints: [],
      });
      continue;
    }
    const id = gapStructureId(tile, f);
    const isBuilding = p.kind === "building";
    const brick = ["chimney", "tower", "lighthouse"].includes(p.kind);
    const tint = rgb(buildingTint(id, {}, brick ? "brick" : facades));
    baked.objects.push({
      building: isBuilding,
      root: index,
      baseZ: cm(p.z - STRUCTURE_SINK),
      eaveH: cm(p.h + STRUCTURE_SINK),
      flags: 0,
      storeyH: cm(isBuilding ? storeyHeight(p.h) : p.h + STRUCTURE_SINK + 1),
      glow: 0,
      rough: r3(roughJitter(id)),
      tint,
      roof: isBuilding ? rgb(roofTint(id, { roofType: "1000" })) : tint,
      source: OBJECT_SOURCE_GAP,
      footprints: [
        structureFootprint(f).map(([x, y]): [number, number] => [cm(x), cm(y)]),
      ],
    });
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(v.isRoof, isRoof),
  };
}

/** A gap structure's hash key: its kind and anchor to the decimetre. */
export function gapStructureId(tile: string, f: StructureFeature): string {
  const [x, y] =
    f.geometry.type === "Point"
      ? f.geometry.coordinates
      : (f.geometry.coordinates[0]?.[0] ?? [0, 0]);
  return `gap:${tile}:${f.properties?.kind}:${x.toFixed(1)}:${y.toFixed(1)}`;
}

/** THREE's polygon triangulation behind lib/city/structures.ts's
 *  `Triangulate` (flat coordinates, hole starts → flat index triples). */
export const triangulateXY = (data: number[], holes: number[]): number[] => {
  const pts: Vector2[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    pts.push(new Vector2(data[i], data[i + 1]));
  }
  const cuts = [...holes, pts.length];
  const contour = pts.slice(0, cuts[0]);
  const rings = holes.map((start, i) => pts.slice(start, cuts[i + 1]));
  // triangulateShape indexes contour ++ holes, as Triangulate does
  return ShapeUtils.triangulateShape(contour, rings).flat();
};

/** A scan structure's hash key: the tile and its ring's first corner to the
 *  decimetre — stable when the tile's LoD2 object count changes. */
export function scanStructureId(tile: string, f: SmallBuildingFeature): string {
  const [x, y] = f.geometry.coordinates[0]?.[0] ?? [0, 0];
  return `scan:${tile}:${x.toFixed(1)}:${y.toFixed(1)}`;
}

function concat(
  a: Float32Array<ArrayBuffer>,
  b: readonly number[]
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Parses and annotates one tile. `sharedMatrix` is the spawn tile's
 * recenter matrix (null for the primary itself), exactly as the browser
 * used to pass it, so every tile lands in the same recentered frame.
 * `osmLut` holds what OSM knows per object (shops, heritage), when baked;
 * a part carries its own flags and its root Building's. `facades` is the
 * site's wall material (the tint palette).
 */
export function bakeCityMesh(
  tile: string,
  source: CityJsonDocument,
  roofLut: RoofColorLut | undefined,
  sharedMatrix: Matrix4 | null,
  osmLut?: OsmBuildingLut,
  scan?: readonly SmallBuildingFeature[],
  facades: FacadeMaterial = "render",
  gaps?: readonly StructureFeature[]
): BakedCityMesh {
  // Bridges are the rail layer's (ALKIS 53001 slabs would double the decks).
  const doc = withoutTrafficStructures(source);
  const epsg = epsgCodeFromReferenceSystem(doc.metadata?.referenceSystem);
  if (epsg === null) {
    throw new Error(
      `Unsupported CityJSON CRS "${doc.metadata?.referenceSystem}" in ${tile} — ` +
        "expected ETRS89/UTM (EPSG:25832 or 25833)."
    );
  }
  const loader = new CityJSONLoader(new CityJSONParser());
  if (sharedMatrix) {
    loader.matrix = sharedMatrix;
  }
  loader.load(doc);
  const matrix = loader.matrix;
  const offset = recenterOffset(matrix);
  const v = collectVertices(loader.scene);

  const keys = Object.keys(doc.CityObjects);
  // Per-object vertex scans: base (lowest Z), top and lowest ROOF vertex.
  const minZ = new Map<number, number>();
  const maxZ = new Map<number, number>();
  const roofMinZ = new Map<number, number>();
  for (let i = 0; i < v.objectIds.length; i++) {
    const idx = v.objectIds[i];
    const z = v.positions[i * 3 + 2];
    minZ.set(idx, Math.min(minZ.get(idx) ?? z, z));
    maxZ.set(idx, Math.max(maxZ.get(idx) ?? z, z));
    if (v.isRoof[i] === 1) {
      roofMinZ.set(idx, Math.min(roofMinZ.get(idx) ?? z, z));
    }
  }

  const objects: CityObjectRow[] = keys.map((id, index) => {
    const o = doc.CityObjects[id];
    const root = rootOf(doc, keys, index);
    const own = o.attributes ?? {};
    // A BuildingPart takes its use (`function`) from its Building: tint,
    // roof and glow read the resolved bag; heights stay the part's own.
    const attrs = inheritedAttributes(
      own,
      doc.CityObjects[keys[root]].attributes
    );
    const baseZ = minZ.get(index) ?? 0;
    const total = (maxZ.get(index) ?? baseZ) - baseZ;
    const measured =
      typeof own.measuredHeight === "number" ? own.measuredHeight : total;
    const roofMin = roofMinZ.get(index);
    const look = inheritedLook(osmLut?.[id], osmLut?.[keys[root]]);
    const footprints = buildingFootprintPolys({
      ...doc,
      CityObjects: { [id]: o },
    }).map((p) => p.pts.map(([x, y]): [number, number] => [cm(x), cm(y)]));
    return {
      building: o.type === "Building",
      root,
      baseZ: cm(baseZ),
      eaveH: cm(roofMin === undefined ? total : Math.max(roofMin - baseZ, 0)),
      flags: inheritedFlags(osmLut?.[id], osmLut?.[keys[root]]),
      storeyH: cm(storeyHeight(measured)),
      glow: buildingGlows(attrs) ? 1 : 0,
      rough: r3(roughJitter(id)),
      tint: rgb(buildingTint(id, attrs, facades, look)),
      roof: rgb(roofColor(id, attrs, roofLut, look)),
      footprints,
    };
  });

  const baked = { epsg, matrix, objects, offset, vertices: v };
  if (scan) {
    appendScanStructures(tile, baked, scan);
  }
  if (gaps) {
    appendGapStructures(
      tile,
      baked,
      gaps,
      facades,
      new Map(keys.map((id, i) => [id, i]))
    );
  }
  return baked;
}
