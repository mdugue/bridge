/**
 * Parses one tile's CityJSON into the building mesh the viewer streams (as
 * glTF, scripts/bake-tiles.ts): runs cityjson-threejs-loader once, then
 * folds in everything the clay style needs per building (tints, roof colour
 * incl. the DOP LUT, storey/eave heights, dusk glow, roughness jitter), the
 * OSM flags (shop, heritage; a part carries its Building's too), the
 * demolish tree and the minimap footprints, then appends the small
 * structures the laser scan saw and LoD2 lacks (`appendScanStructures`).
 * An object whose LoD2 roof misses DOM1 wears its measured parts
 * instead (`withMeasuredRoofs`, scripts/measured-roofs.ts).
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
  ownFacade,
  buildingTint,
  type FacadeMaterial,
  inheritedAttributes,
  type RoofColorLut,
  roofColor,
  roofTint,
  roughJitter,
  mappedStoreyHeight,
  storeyHeight,
} from "../lib/city/building-tint";
import {
  type CityObjectRow,
  hasObjectFlag,
  inheritedFlags,
  inheritedLook,
  markFlatRoofs,
  markGrounded,
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_LANDMARK,
  OBJECT_FLAG_METAL,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_DOOR,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_PLINTH,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_SCAN,
  OBJECT_SOURCE_SHOPFRONT,
  type OsmBuildingLut,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import { epsgCodeFromReferenceSystem } from "../lib/city/crs";
import {
  DOOR_SINK,
  DOOR_SURROUND,
  doorMesh,
  eaveAlong,
  wallShift,
  wallShiftAlong,
  wallShiftKnots,
} from "../lib/city/doors";
import { dormerMesh } from "../lib/city/dormers";
import {
  type BandKind,
  bandMeshes,
  CORNICE,
  EAVE_CORNICE,
  type HostShift,
  joinStretches,
  lineStretches,
  plinthStretches,
  type Shaded,
  type Stretch,
  straightRuns,
} from "../lib/city/plinths";
import type {
  DoorFeature,
  DormerFeature,
  MeasuredRoofFeature,
  ShopfrontWall,
  PlinthFeature,
  SmallBuildingFeature,
  StructureFeature,
} from "../lib/city/features";
import { buildingFootprintPolys } from "../lib/city/minimap";
import {
  doorSpans,
  footAt,
  paneTop,
  CANOPY,
  SHOPFRONT,
  shopfrontMesh,
  wallBays,
  wallShiftAt,
} from "../lib/city/shopfronts";
import {
  inheritedOsm,
  lod2Facts,
  scanFacts,
  treeFacts,
} from "../lib/city/object-facts";
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
import {
  facadeAttribute,
  type WindowHost,
  type WindowWall,
  windowSpecs,
} from "../lib/city/windows";
import { measuredRoofMesh, measuredRoofsById } from "./measured-roofs";

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

/** What the bake lays on the LoD2 walls, each feature on its host. */
export interface OnWalls {
  doors?: readonly DoorFeature[];
  dormers?: readonly DormerFeature[];
  plinths?: readonly PlinthFeature[];
  shopfronts?: readonly ShopfrontWall[];
  windows?: readonly WindowWall[];
}

/** The mesh as non-indexed triangles, flat per-face vertices. */
export interface CityVertices {
  /** per vertex where it lies on its wall, for the windows (4 × snorm16,
   *  lib/city/windows.ts `facadeAttribute`); absent: no windows */
  facade?: Int16Array<ArrayBuffer>;
  /** 1 on RoofSurface vertices, 0 elsewhere */
  isRoof: Float32Array<ArrayBuffer>;
  /** per vertex, a normal to shade with in place of the triangle's flat
   *  one (a measured face's, smoothed over it); NaN or absent: flat */
  normals?: Float32Array<ArrayBuffer>;
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
    const footprint = corners.map((c): [number, number] => [cm(c.x), cm(c.y)]);
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
      footprints: [footprint],
      facts: scanFacts({ id, footprint, height: f.properties?.h }),
    });
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(v.isRoof, isRoof),
    ...flatNormalsAfter(v, positions.length),
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
    ...flatNormalsAfter(v, positions.length),
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

/** The stream's normals run on, flat (NaN), over `count` appended
 *  coordinates; nothing when the stream carries none. */
function flatNormalsAfter(
  v: CityVertices,
  count: number
): Pick<CityVertices, "normals"> {
  if (!v.normals) {
    return {};
  }
  const normals = new Float32Array(v.normals.length + count).fill(Number.NaN);
  normals.set(v.normals);
  return { normals };
}

/** The stream's normals run on with `appended` (NaN: flat), the stream's
 *  own flat where it carries none. */
function shadedNormalsAfter(
  v: CityVertices,
  appended: readonly number[]
): Float32Array<ArrayBuffer> {
  const own =
    v.normals ?? new Float32Array(v.positions.length).fill(Number.NaN);
  return concat(own, appended);
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
 * The vertex stream with every object that has measured parts rebuilt:
 * its LoD2 triangles dropped, its prisms appended under the same object id
 * (so its table row, picking and demolish stay), standing on the lowest
 * vertex of its LoD2 shell. A part id the tile does not hold is ignored.
 */
export function withMeasuredRoofs(
  v: CityVertices,
  keys: readonly string[],
  offset: { cx: number; cy: number },
  features: readonly MeasuredRoofFeature[]
): CityVertices {
  const byId = measuredRoofsById(features);
  const replaced = new Map<number, MeasuredRoofFeature[]>();
  keys.forEach((id, index) => {
    const parts = byId.get(id);
    if (parts) {
      replaced.set(index, parts);
    }
  });
  if (replaced.size === 0) {
    return v;
  }
  const base = new Map<number, number>();
  const keep: number[] = [];
  for (let i = 0; i < v.objectIds.length; i++) {
    const idx = v.objectIds[i];
    if (replaced.has(idx)) {
      const z = v.positions[i * 3 + 2];
      base.set(idx, Math.min(base.get(idx) ?? z, z));
    } else {
      keep.push(i);
    }
  }
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  const normals: number[] = [];
  for (const i of keep) {
    positions.push(
      v.positions[i * 3],
      v.positions[i * 3 + 1],
      v.positions[i * 3 + 2]
    );
    objectIds.push(v.objectIds[i]);
    isRoof.push(v.isRoof[i]);
    normals.push(Number.NaN, Number.NaN, Number.NaN);
  }
  for (const [index, parts] of replaced) {
    const z = base.get(index);
    if (z === undefined) {
      continue;
    }
    const mesh = measuredRoofMesh(parts, z, offset);
    positions.push(...mesh.positions);
    isRoof.push(...mesh.isRoof);
    objectIds.push(...mesh.isRoof.map(() => index));
    normals.push(...mesh.normals);
  }
  return {
    positions: Float32Array.from(positions),
    objectIds: Float32Array.from(objectIds),
    isRoof: Float32Array.from(isRoof),
    normals: Float32Array.from(normals),
  };
}

/**
 * Parses and annotates one tile. `sharedMatrix` is the spawn tile's
 * recenter matrix (null for the primary itself), exactly as the browser
 * used to pass it, so every tile lands in the same recentered frame.
 * `osmLut` holds what OSM knows per object (shops, heritage), when baked;
 * a part carries its own flags and its root Building's. `facades` is the
 * tile's wall material (the tint palette; osm_buildings.py `context`), an
 * object's own neighbourhood overriding it.
 * `measured` are the roofs rebuilt from DOM1, when baked; `onWalls` OSM's
 * doors, the surface model's dormers and the shopfronts (street photos,
 * the surface model's canopies), each on its LoD2 host.
 */
export function bakeCityMesh(
  tile: string,
  source: CityJsonDocument,
  roofLut: RoofColorLut | undefined,
  sharedMatrix: Matrix4 | null,
  osmLut?: OsmBuildingLut,
  scan?: readonly SmallBuildingFeature[],
  facades: FacadeMaterial = "render",
  gaps?: readonly StructureFeature[],
  measured?: readonly MeasuredRoofFeature[],
  onWalls: OnWalls = {}
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
  const keys = Object.keys(doc.CityObjects);
  // Footprints first: the loader rewrites the document it parses (a
  // Solid's semantic `values` come back flattened), after which a Solid's
  // GroundSurface can no longer be found — every BuildingPart and most
  // Buildings lost their minimap footprint that way.
  const footprintsOf = keys.map((id) =>
    buildingFootprintPolys({
      ...doc,
      CityObjects: { [id]: doc.CityObjects[id] },
    }).map((p) => p.pts.map(([x, y]): [number, number] => [cm(x), cm(y)]))
  );
  const loader = new CityJSONLoader(new CityJSONParser());
  if (sharedMatrix) {
    loader.matrix = sharedMatrix;
  }
  loader.load(doc);
  const matrix = loader.matrix;
  const offset = recenterOffset(matrix);
  const v = withMeasuredRoofs(
    collectVertices(loader.scene),
    keys,
    offset,
    measured ?? []
  );

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

  // the objects drawn as their measured parts (ADR 0036): their facts
  // say so, not what the LoD2 roof said
  const rebuilt = measuredRoofsById(measured ?? []);
  // what the windows read beyond the row: the function, OSM's storeys,
  // a facade of its own (a landmark's flag alone keeps its windows)
  const hosts: WindowExtra[] = [];
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
    const osm = inheritedOsm(osmLut?.[id], osmLut?.[keys[root]]);
    const eaveH = roofMin === undefined ? total : Math.max(roofMin - baseZ, 0);
    const footprints = footprintsOf[index];
    const monumental = ownFacade(attrs, eaveH, osm?.levels);
    hosts[index] = windowExtra(attrs, osm?.levels, monumental);
    return {
      building: o.type === "Building",
      root,
      baseZ: cm(baseZ),
      eaveH: cm(eaveH),
      flags: facadeFlags(
        inheritedFlags(osmLut?.[id], osmLut?.[keys[root]]),
        monumental
      ),
      storeyH: cm(mappedStoreyHeight(eaveH, measured, osm?.levels)),
      glow: buildingGlows(attrs) ? 1 : 0,
      rough: r3(roughJitter(id)),
      tint: rgb(buildingTint(id, attrs, look.context ?? facades, look)),
      roof: rgb(roofColor(id, attrs, roofLut, look)),
      footprints,
      facts: lod2Facts({
        buildingId: keys[root],
        own,
        resolved: attrs,
        osm,
        fallbackHeight: total,
        footprints,
        rebuilt: rebuilt.has(id),
        shaped: rebuilt.get(id)?.some((f) => f.properties?.surface) ?? false,
      }),
    };
  });

  // A Building with parts answers for its whole tree (the inquiry card
  // reads it): the union of the footprints, the tree's height.
  const trees = new Map<number, number[]>();
  objects.forEach((o, i) =>
    trees.set(o.root, [...(trees.get(o.root) ?? []), i])
  );
  for (const [root, members] of trees) {
    const facts = objects[root].facts;
    if (members.length > 1 && facts) {
      objects[root].facts = treeFacts(
        facts,
        // only what has geometry: a Building drawn by its parts has no
        // base of its own
        members
          .filter((i) => minZ.has(i))
          .map((i) => ({
            baseZ: minZ.get(i) ?? 0,
            topZ: maxZ.get(i) ?? 0,
            footprints: footprintsOf[i],
          })),
        typeof doc.CityObjects[keys[root]].attributes?.measuredHeight ===
          "number" && members.every((i) => !rebuilt.has(keys[i]))
      );
    }
  }

  const baked: BakedCityMesh = { epsg, matrix, objects, offset, vertices: v };
  markFlatRoofs(objects, v);
  dressWalls(tile, baked, keys, hosts, onWalls, { facades, gaps, scan });
  return baked;
}

/**
 * The walls' storeys, windows and parts, in the order they read each
 * other: the storeys counted from the street, then the windows (the
 * plinths' and shopfronts' heights read the storey they snap to the
 * eave), then the parts beyond LoD2, and last each wall vertex's place on
 * its wall.
 */
function dressWalls(
  tile: string,
  baked: BakedCityMesh,
  keys: readonly string[],
  hosts: readonly WindowExtra[],
  onWalls: OnWalls,
  extra: {
    facades: FacadeMaterial;
    gaps?: readonly StructureFeature[];
    scan?: readonly SmallBuildingFeature[];
  }
): void {
  const plinths = onWalls.plinths ?? [];
  // the storeys count from the street, where the plinths say where it is
  const asBuilt = liftToStreet(baked.objects, keys, plinths);
  assignWindows(baked.objects, keys, hosts, onWalls.windows ?? [], plinths);
  appendBeyondLod2(tile, baked, keys, { ...onWalls, ...extra });
  // standing on the ground or on a roof: as LoD2 built them
  markGrounded(baked.objects, asBuilt);
  // the parts laid on the walls copied their host's row: windows are the
  // LoD2 walls' alone
  for (const o of baked.objects) {
    if ((o.source ?? OBJECT_SOURCE_LOD2) !== OBJECT_SOURCE_LOD2) {
      delete o.windows;
    }
  }
  baked.vertices.facade = facadeOf(baked, keys, onWalls);
}

/** What the windows read of an object beyond its row: its function,
 *  whether OSM counts its storeys, a facade of its own. */
function windowExtra(
  attrs: Record<string, unknown>,
  levels: number | undefined,
  monumental: boolean
): WindowExtra {
  return {
    fn: typeof attrs.function === "string" ? attrs.function : undefined,
    levels: (levels ?? 0) >= 1,
    monumental,
  };
}

/** The flags with OBJECT_FLAG_LANDMARK where the facade is its own. */
function facadeFlags(flags: number, own: boolean): number {
  return own && !hasObjectFlag(flags, OBJECT_FLAG_LANDMARK)
    ? flags + OBJECT_FLAG_LANDMARK
    : flags;
}

/** What the tile's mesh carries beyond LoD2: the scan's sheds, the
 *  surface model's structures and dormers, OSM's doors (each on its LoD2
 *  host). */
function appendBeyondLod2(
  tile: string,
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  keys: readonly string[],
  extra: {
    doors?: readonly DoorFeature[];
    dormers?: readonly DormerFeature[];
    facades: FacadeMaterial;
    plinths?: readonly PlinthFeature[];
    shopfronts?: readonly ShopfrontWall[];
    gaps?: readonly StructureFeature[];
    scan?: readonly SmallBuildingFeature[];
  }
): void {
  if (extra.scan) {
    appendScanStructures(tile, baked, extra.scan);
  }
  const objectIndex = new Map(keys.map((id, i) => [id, i]));
  if (extra.gaps) {
    appendGapStructures(tile, baked, extra.gaps, extra.facades, objectIndex);
  }
  if (extra.plinths) {
    appendPlinths(baked, extra.plinths, objectIndex);
  }
  if (extra.shopfronts) {
    // before the doors: a bay is cut at a door, which the doors then draw
    appendShopfronts(baked, extra.shopfronts, extra.doors ?? [], objectIndex);
  }
  if (extra.doors) {
    appendDoors(baked, extra.doors, objectIndex);
  }
  if (extra.dormers) {
    appendDormers(baked, extra.dormers, objectIndex);
  }
}

/** Each building tree's triangles (its root → each triangle's first vertex):
 *  the walls a door is laid on. */
function treeTriangles(
  baked: Pick<BakedCityMesh, "objects" | "vertices">
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const ids = baked.vertices.objectIds;
  for (let t = 0; t + 2 < ids.length; t += 3) {
    const root = baked.objects[ids[t]]?.root;
    if (root !== undefined) {
      const list = out.get(root);
      if (list) {
        list.push(t);
      } else {
        out.set(root, [t]);
      }
    }
  }
  return out;
}

/** A plinth's stone: its wall's tint, a touch darker and cooler. */
const PLINTH_STONE: [number, number, number] = [0.62, 0.62, 0.64];
/** What a plinth's host must not be: a facade of its own (a landmark, a
 *  church), a part with its own colour, glass or metal cladding, or a
 *  flat-roofed block — the painted Gliederung's own gate. */
const NO_PLINTH =
  OBJECT_FLAG_LANDMARK |
  OBJECT_FLAG_OWN_COLOUR |
  OBJECT_FLAG_GLASS |
  OBJECT_FLAG_METAL |
  OBJECT_FLAG_FLAT_ROOF;
/** A part whose base stands this far over the ground at its plinth stands
 *  on a roof (a tower's part), not on the street. */
const PLINTH_ON_GROUND_M = 1.5;

/** Whether a plinth piece is drawn on its host: not on a facade of its
 *  own, glass, metal or a flat-roofed block (`NO_PLINTH`), not under 3 m
 *  of wall, not on a part standing on a roof. */
function carriesPlinth(
  host: Pick<CityObjectRow, "baseZ" | "eaveH" | "flags">,
  ground: readonly number[]
): boolean {
  return (
    (host.flags & NO_PLINTH) === 0 &&
    host.eaveH >= 3 &&
    host.baseZ <= Math.min(...ground) + PLINTH_ON_GROUND_M
  );
}

/**
 * The plinths on the LoD2 walls' street side (pipeline/bake/plinths.py),
 * appended as part of the building they carry, like its doors: one object
 * per host in a stone shade of the host's tint, the host's building tree
 * (asking or demolishing it takes the building), no footprint, no storey
 * band or eave line on it, `source` 5. Only a town house carries one: a
 * host from 3 m of wall, standing on the street, not `NO_PLINTH`. Along
 * the same stretches the Gurtgesims over its ground floor
 * (`corniceHeight`) and the Traufgesims under its eave where the roof runs
 * level along the wall (`eaveAlong`), each an object in a plaster shade a
 * touch paler than the wall. Each band runs on from house to house along
 * a row (`joinStretches`): over the gaps LoD2's footprints leave between
 * them, at one level where theirs lie close.
 */
export function appendPlinths(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  plinths: readonly PlinthFeature[],
  objectIndex: ReadonlyMap<string, number>
): void {
  const positions: number[] = [];
  const normals: number[] = [];
  const objectIds: number[] = [];
  const walls = treeTriangles(baked);
  const vertices = baked.vertices.positions;
  const isRoof = baked.vertices.isRoof;
  const roofs = new Map<number, number[]>();
  for (const [root, tris] of walls) {
    roofs.set(
      root,
      tris.filter((t) => isRoof[t] === 1)
    );
  }
  const part = (
    tris: Shaded,
    host: CityObjectRow,
    tint: [number, number, number]
  ) => {
    const zs = tris.positions.filter((_, i) => i % 3 === 2);
    if (zs.length === 0) {
      return;
    }
    const [base, top] = [Math.min(...zs), Math.max(...zs)];
    const index = baked.objects.length;
    positions.push(...tris.positions);
    normals.push(...tris.normals);
    for (let i = 0; i < tris.positions.length / 3; i++) {
      objectIds.push(index);
    }
    const above = cm(top - base + 1);
    baked.objects.push({
      ...host,
      building: false,
      baseZ: cm(base),
      // above its top: no eave stroke, no storey band on it
      eaveH: above,
      storeyH: above,
      glow: 0,
      // its own colour, none of the host's OSM looks (no shop wash)
      flags: OBJECT_FLAG_OWN_COLOUR,
      tint,
      source: OBJECT_SOURCE_PLINTH,
      footprints: [],
    });
  };
  const wallOf = (h: number) => walls.get(baked.objects[h].root) ?? [];
  const shift: HostShift = (h, a, b, z0, z1) =>
    wallShiftKnots([a, b], [z0, z1], baked.offset, vertices, wallOf(h));
  const bands: Record<BandKind, Stretch[]> = {
    plinth: [],
    cornice: [],
    eave: [],
  };
  for (const f of plinths) {
    const p = f.properties;
    const hostIndex = p ? objectIndex.get(p.of) : undefined;
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (!(p && host && hostIndex !== undefined && carriesPlinth(host, p.g))) {
      continue;
    }
    bands.plinth.push(...plinthStretches(f, hostIndex));
    const top = Math.max(...p.top);
    const z = corniceHeight(host, top);
    if (z !== undefined) {
      bands.cornice.push(...lineStretches(f, hostIndex, z));
    }
    bands.eave.push(
      ...eaveStretches(f, hostIndex, host, z ?? top, (a, b, z0, z1) =>
        eaveAlong(
          [a, b],
          wallShiftAlong(
            [a, b],
            [z0, z1],
            baked.offset,
            vertices,
            wallOf(hostIndex)
          ),
          baked.offset,
          vertices,
          roofs.get(host.root) ?? []
        )
      )
    );
  }
  const tolerance: Record<BandKind, number> = {
    plinth: 0.2,
    cornice: 0.6,
    eave: EAVE_STEP_M,
  };
  for (const kind of ["plinth", "cornice", "eave"] as const) {
    const joined = joinStretches(
      bands[kind],
      kind === "plinth" ? "plinth" : "line",
      tolerance[kind]
    );
    for (const [h, tris] of bandMeshes(joined, baked.offset, kind, shift)) {
      const host = baked.objects[h];
      // close to the wall: the form, not the colour, carries it
      const tint =
        kind === "plinth"
          ? mixRgb(
              host.tint.map((c) => c * 0.9),
              PLINTH_STONE,
              0.25
            )
          : mixRgb(host.tint, SURROUND_STONE, 0.08);
      part(tris, host, tint);
    }
  }
  if (positions.length === 0) {
    return;
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(
      v.isRoof,
      objectIds.map(() => 0)
    ),
    normals: concat(
      v.normals ?? new Float32Array(v.positions.length).fill(Number.NaN),
      normals
    ),
  };
}

/** Neighbouring houses' Traufgesimse this close in height run as one. */
const EAVE_STEP_M = 0.25;
/** A Traufgesims from this much wall, and this far over the band below. */
const EAVE_MIN_M = 5;
const EAVE_CLEAR_M = 1.5;

/** A host's Traufgesims along its plinth's straight runs: where the roof
 *  runs level along the wall (`eave`), its underside `EAVE_CORNICE.height`
 *  under the eave — on a wall from `EAVE_MIN_M`, `EAVE_CLEAR_M` over the
 *  band below it (`under`: the Gurtgesims, or the plinth's top). */
function eaveStretches(
  f: PlinthFeature,
  hostIndex: number,
  host: CityObjectRow,
  under: number,
  /** the eave along a→b, the wall read between two heights */
  eave: (
    a: readonly number[],
    b: readonly number[],
    z0: number,
    z1: number
  ) => number | undefined
): Stretch[] {
  const guess = host.baseZ + host.eaveH;
  return straightRuns(f.geometry.coordinates).flatMap(([a, b]) => {
    const e = eave(a, b, guess - 1.5, guess - 0.5);
    const z = e === undefined ? undefined : e - EAVE_CORNICE.height;
    return z !== undefined &&
      e !== undefined &&
      e - host.baseZ >= EAVE_MIN_M &&
      z > under + EAVE_CLEAR_M
      ? [{ a, b, lo: z, hi: z, host: hostIndex }]
      : [];
  });
}

/** Where a host's Gurtgesims sits (its underside, absolute): straddling
 *  the first storey line over the host's base, as the painted ledge did —
 *  only where the wall holds two storeys and the line stands a metre
 *  clear of the plinth's top. */
export function corniceHeight(
  host: Pick<CityObjectRow, "baseZ" | "eaveH" | "storeyH">,
  plinthTop: number
): number | undefined {
  const storey = Math.max(host.storeyH, 2.4);
  if (host.eaveH < 2 * storey - 0.3) {
    return undefined;
  }
  const z = host.baseZ + storey - CORNICE.height / 2;
  return z > plinthTop + 1 ? z : undefined;
}

/** A doorway's surround: its wall's tint, lifted towards a pale stone. */
const SURROUND_STONE: [number, number, number] = [0.88, 0.85, 0.78];
/** A door leaf: dark wood in its wall's cast; a garage door a calm grey. */
const LEAF_WOOD: [number, number, number] = [0.31, 0.24, 0.18];
const LEAF_GARAGE: [number, number, number] = [0.5, 0.5, 0.48];

const mixRgb = (
  a: readonly number[],
  b: readonly number[],
  t: number
): [number, number, number] => [
  r3(a[0] + (b[0] - a[0]) * t),
  r3(a[1] + (b[1] - a[1]) * t),
  r3(a[2] + (b[2] - a[2]) * t),
];

/**
 * OSM's entrances on the LoD2 walls (pipeline/bake/doors.py), appended as
 * part of the object they open, like a landmark's relief: two objects per
 * door (the surround and the leaf, each its own tint), the host's building
 * tree (asking or demolishing a door takes the building), no footprint, no
 * storey band or eave line on them, `source` 3. A door whose host the tile
 * does not hold is dropped.
 */
export function appendDoors(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  doors: readonly DoorFeature[],
  objectIndex: ReadonlyMap<string, number>
): void {
  if (doors.length === 0) {
    return;
  }
  const positions: number[] = [];
  const objectIds: number[] = [];
  const walls = treeTriangles(baked);
  for (const f of doors) {
    const p = f.properties;
    const hostIndex = p ? objectIndex.get(p.of) : undefined;
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    // a landmark's or a church's portal is its own: no generic door on it
    if (!(p && host) || hasObjectFlag(host.flags, OBJECT_FLAG_LANDMARK)) {
      continue;
    }
    const shift = wallShift(
      f,
      baked.offset,
      baked.vertices.positions,
      walls.get(host.root) ?? []
    );
    const mesh = doorMesh(f, baked.offset, shift);
    const base = p.z - DOOR_SINK;
    const top = p.h + DOOR_SINK + DOOR_SURROUND.width;
    const part = (tris: number[], tint: [number, number, number]) => {
      const index = baked.objects.length;
      positions.push(...tris);
      for (let i = 0; i < tris.length / 3; i++) {
        objectIds.push(index);
      }
      baked.objects.push({
        ...host,
        building: false,
        baseZ: cm(base),
        // above the door: no eave stroke, no storey band on it
        eaveH: cm(top + 1),
        storeyH: cm(top + 1),
        glow: 0,
        // its own colour, none of the host's OSM looks (no shop wash)
        flags: OBJECT_FLAG_OWN_COLOUR,
        tint,
        source: OBJECT_SOURCE_DOOR,
        footprints: [],
      });
    };
    // as calm as the painted plinth and cornices: the surround barely off
    // its wall, the leaf a shade of the wall rather than a dark hole
    part(mesh.surround, mixRgb(host.tint, SURROUND_STONE, 0.2));
    part(
      mesh.leaf,
      mixRgb(
        host.tint.map((c) => c * 0.62),
        p.kind === "garage" ? LEAF_GARAGE : LEAF_WOOD,
        p.kind === "main" ? 0.45 : 0.3
      )
    );
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(
      v.isRoof,
      objectIds.map(() => 0)
    ),
    ...flatNormalsAfter(v, positions.length),
  };
}

/** The clay's base colour (the material's 0xece7df, linear) and how much
 *  of a building's tint the walls show at the Farbvariation slider's
 *  default (lib/city/look-controls.ts): a wall as one sees it. */
const CLAY_BASE: [number, number, number] = [0.838, 0.799, 0.737];
const WALL_TINT_SHOWN = 0.6;
/** A shop window: a muted glass a little darker and cooler than its wall
 *  — the wall as shown, darkened, drawn towards a cool slate — not a
 *  black hole; smooth enough to hold a calm reflection of the sun (its
 *  `rough` column is the pane's roughness, read as such for own-colour
 *  glass) and of the sky (the clay's `paneSky`,
 *  app/_components/visual-style.ts). */
const PANE_SLATE: [number, number, number] = [0.07, 0.09, 0.12];
export const PANE_ROUGH = 0.2;
/** A shopfront's surround and fascia: its wall as shown, a shade darker
 *  and a touch cooler — part of the wall, not a frame. */
const SURROUND_COOL: [number, number, number] = [0.52, 0.55, 0.6];
/** A host this far above the ground in front of its wall stands on another
 *  part (a storey on a podium, a roof terrace): no shopfront on it. */
const SHOP_HOST_ABOVE_M = 2;

/** The shop glass and the surround for a host of tint `tint` (linear). */
export function shopfrontColours(tint: readonly number[]): {
  glass: [number, number, number];
  surround: [number, number, number];
} {
  const wall = mixRgb(CLAY_BASE, tint, WALL_TINT_SHOWN);
  return {
    glass: mixRgb(
      wall.map((c) => c * 0.4),
      PANE_SLATE,
      0.45
    ),
    surround: mixRgb(
      wall.map((c) => c * 0.9),
      SURROUND_COOL,
      0.12
    ),
  };
}

/**
 * The shopfronts on the LoD2 walls (pipeline/bake/shopfronts.py: bays and
 * signs from street photos, canopies from the surface model), appended as
 * part of the object they front, like the doors: per wall one object per
 * run of glass (its `eaveH` the pane's top, where the head's soft shadow
 * falls — `paneShade` in visual-style.ts), the surrounds and fascias as one
 * (rounded: their own smooth normals), the canopy in the host's own clay;
 * the host's building tree (asking or demolishing one takes the
 * building), no footprint, no storey band or eave line on them, `source` 6
 * (a wall with a sign and no bay gets its fascia alone).
 * Skipped: a host the tile does not hold, a glass or metal
 * facade (its own front), a host not on the ground; a bay is cut where an
 * OSM door stands. Returns the walls drawn.
 */
export function appendShopfronts(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  walls: readonly ShopfrontWall[],
  doors: readonly DoorFeature[],
  objectIndex: ReadonlyMap<string, number>
): number {
  const positions: number[] = [];
  const normals: number[] = [];
  const objectIds: number[] = [];
  const trees = treeTriangles(baked);
  const rootOf = (id: string) => {
    const i = objectIndex.get(id);
    return i === undefined ? undefined : baked.objects[i]?.root;
  };
  let drawn = 0;
  for (const w of walls) {
    const hostIndex = objectIndex.get(w.oid);
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (!(host && w.z) || !shopHost(host, w)) {
      continue;
    }
    const bays = wallBays(
      w,
      doorSpans(w, doors, (of) => rootOf(of) === host.root)
    );
    const triangles = trees.get(host.root) ?? [];
    const mesh = shopfrontMesh(w, bays, host.storeyH, baked.offset, (span) =>
      wallShiftAt(w, span, baked.offset, baked.vertices.positions, triangles)
    );
    if (
      mesh.panes.length === 0 &&
      mesh.frame.positions.length === 0 &&
      mesh.canopy.positions.length === 0
    ) {
      continue;
    }
    drawn++;
    const base = footAt(w, [0, w.L]);
    const above = cm(
      Math.max(...(w.z ?? [0])) -
        base +
        Math.max(
          paneTop(w, host.storeyH) + SHOPFRONT.head + CANOPY.tuck,
          w.sign?.z?.[1] ?? 0,
          ...(w.canopy ?? []).map((c) => c.h)
        ) +
        1
    );
    const part = (
      tris: Shaded,
      tint: [number, number, number],
      flags: number,
      rough: number,
      eaveH = above
    ) => {
      const index = baked.objects.length;
      positions.push(...tris.positions);
      normals.push(...tris.normals);
      for (let i = 0; i < tris.positions.length / 9; i++) {
        objectIds.push(index, index, index);
      }
      baked.objects.push({
        ...host,
        building: false,
        baseZ: cm(base),
        // above the shopfront: no eave stroke, no storey band on it
        eaveH,
        storeyH: above,
        glow: 0,
        // its own colour, none of the host's OSM looks (no shop wash)
        flags,
        rough,
        tint,
        source: OBJECT_SOURCE_SHOPFRONT,
        footprints: [],
      });
    };
    const colours = shopfrontColours(host.tint);
    for (const pane of mesh.panes) {
      part(
        {
          positions: pane.positions,
          normals: pane.positions.map(() => Number.NaN),
        },
        colours.glass,
        OBJECT_FLAG_OWN_COLOUR + OBJECT_FLAG_GLASS,
        PANE_ROUGH,
        // the glass's eave is its top: the head's shadow under it
        cm(pane.top - base)
      );
    }
    if (mesh.frame.positions.length > 0) {
      part(mesh.frame, colours.surround, OBJECT_FLAG_OWN_COLOUR, host.rough);
    }
    // the canopy is the building's own: its clay and tint, lit like its
    // walls (not a frame's darker own colour), the shop wash left to the
    // ground floor behind it
    if (mesh.canopy.positions.length > 0) {
      part(mesh.canopy, host.tint, host.flags & ~OBJECT_FLAG_SHOP, host.rough);
    }
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(
      v.isRoof,
      objectIds.map(() => 0)
    ),
    normals: shadedNormalsAfter(v, normals),
  };
  return drawn;
}

/** Whether a host may wear a shopfront: not a glass or metal facade (its
 *  own front), and standing on the ground in front of the wall. */
function shopHost(
  host: Pick<CityObjectRow, "baseZ" | "flags">,
  w: ShopfrontWall
): boolean {
  if (
    hasObjectFlag(host.flags, OBJECT_FLAG_GLASS) ||
    hasObjectFlag(host.flags, OBJECT_FLAG_METAL)
  ) {
    return false;
  }
  return host.baseZ <= Math.min(...(w.z ?? [host.baseZ])) + SHOP_HOST_ABOVE_M;
}

/**
 * The dormers the surface model shows on the pitched LoD2 roofs (pipeline/
 * bake/dormers.py), appended as part of the object they sit on: one object
 * per host, in the host's tint and roof colour, the host's building tree
 * (asking or demolishing a dormer takes the building), no footprint, `source`
 * 4. Its walls carry no storey band, eave line, plinth or shop zone (its
 * base is its own, high on the roof). A dormer whose host the tile does not
 * hold is dropped.
 */
export function appendDormers(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  dormers: readonly DormerFeature[],
  objectIndex: ReadonlyMap<string, number>
): void {
  const byHost = new Map<number, DormerFeature[]>();
  for (const f of dormers) {
    const hostIndex = f.properties
      ? objectIndex.get(f.properties.of)
      : undefined;
    if (hostIndex !== undefined && baked.objects[hostIndex]) {
      byHost.set(hostIndex, [...(byHost.get(hostIndex) ?? []), f]);
    }
  }
  if (byHost.size === 0) {
    return;
  }
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  for (const [hostIndex, list] of byHost) {
    const host = baked.objects[hostIndex];
    const index = baked.objects.length;
    let base = Number.POSITIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    for (const f of list) {
      const mesh = dormerMesh(f, baked.offset);
      positions.push(...mesh.positions);
      isRoof.push(...mesh.isRoof);
      for (let i = 0; i < mesh.isRoof.length; i++) {
        objectIds.push(index);
      }
      base = Math.min(base, mesh.base);
      top = Math.max(top, f.properties?.top ?? mesh.base);
    }
    const above = cm(top - base + 1);
    baked.objects.push({
      ...host,
      building: false,
      baseZ: cm(base),
      // above its top: no eave stroke, no storey band on it
      eaveH: above,
      storeyH: above,
      glow: 0,
      // the host's facts but its ground floor's: no shop wash up here
      flags: host.flags & ~OBJECT_FLAG_SHOP,
      source: OBJECT_SOURCE_DORMER,
      footprints: [],
    });
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(v.isRoof, isRoof),
    ...flatNormalsAfter(v, positions.length),
  };
}

/** An object's footprint centre (EPSG): its first ring's mean. */
function footprintCentre(
  footprints: readonly [number, number][][]
): [number, number] | undefined {
  const ring = footprints[0];
  if (!ring?.length) {
    return undefined;
  }
  const x = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const y = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  return [x, y];
}

/** What keeps a building's walls free of windows beside a facade of its
 *  own (`WindowExtra.monumental`): glass or metal cladding, its own colour.
 *  A Wikidata landmark's flag alone does not — most are town houses whose
 *  neighbours have windows (the Neumarkt's, a listed Mietshaus). */
const NO_WINDOW_FLAGS =
  OBJECT_FLAG_GLASS | OBJECT_FLAG_METAL | OBJECT_FLAG_OWN_COLOUR;

/** What the windows read of an object beyond its row. */
export type WindowExtra = Pick<WindowHost, "fn" | "levels"> & {
  /** its facade its own (lib/city/building-tint.ts `ownFacade`: a
   *  church, a palace, a theatre, a hall) */
  monumental?: boolean;
};

/** A building's street level stands at most this far over the lowest
 *  ground under its plinths (m): up a steep street its ground floor's
 *  level lies between. */
const STREET_RISE_M = 1;
/** An object's base moves up to its building's street level from at most
 *  this far under it (m): deeper, it stands in a courtyard or a cut. */
const STREET_UNDER_M = 1.5;

/**
 * Each LoD2 object's base moved up to its building's street level where
 * the building's plinths say where that is (`carriesPlinth`): the highest
 * of their pieces' lowest ground, at most `STREET_RISE_M` over the lowest;
 * its eave stays where it is. A LoD2 base is the lowest ground round the
 * whole footprint — a courtyard's, a light well's, a ramp's — and lay a
 * median 0.3 m under the street on Dresden's spawn tile, so storeys, bands
 * and windows counted from it put the ground floor's windows behind the
 * plinth. Every part of the building moves to the same level, so their
 * storeys meet. Returns the base and eave of each object it moved, as they
 * were.
 */
export function liftToStreet(
  objects: CityObjectRow[],
  keys: readonly string[],
  plinths: readonly PlinthFeature[]
): Map<number, { baseZ: number; eaveH: number }> {
  const index = new Map(keys.map((id, i) => [id, i]));
  const ground = new Map<number, { lo: number; hi: number }>();
  for (const f of plinths) {
    const p = f.properties;
    const i = p ? index.get(p.of) : undefined;
    const host = i === undefined ? undefined : objects[i];
    if (p && host && carriesPlinth(host, p.g)) {
      const had = ground.get(host.root);
      ground.set(host.root, {
        lo: Math.min(had?.lo ?? Number.POSITIVE_INFINITY, ...p.g),
        hi: Math.max(had?.hi ?? Number.NEGATIVE_INFINITY, ...p.g),
      });
    }
  }
  const asBuilt = new Map<number, { baseZ: number; eaveH: number }>();
  objects.forEach((o, i) => {
    const g = ground.get(o.root);
    if (!g || (o.source ?? OBJECT_SOURCE_LOD2) !== OBJECT_SOURCE_LOD2) {
      return;
    }
    const street = Math.min(g.hi, g.lo + STREET_RISE_M);
    const rise = street - o.baseZ;
    if (rise > 0 && rise <= STREET_UNDER_M) {
      asBuilt.set(i, { baseZ: o.baseZ, eaveH: o.eaveH });
      o.eaveH = cm(Math.max(o.eaveH - rise, 0));
      o.baseZ = cm(street);
    }
  });
  return asBuilt;
}

/** How high each object's plinth stands over its base (m), where one is
 *  drawn (`carriesPlinth`): the highest top of its pieces — the
 *  ground-floor windows keep above it. */
function plinthTops(
  objects: readonly CityObjectRow[],
  plinths: readonly PlinthFeature[],
  index: ReadonlyMap<string, number>
): Map<number, number> {
  const tops = new Map<number, number>();
  for (const f of plinths) {
    const p = f.properties;
    const i = p ? index.get(p.of) : undefined;
    const host = i === undefined ? undefined : objects[i];
    if (p && host && i !== undefined && carriesPlinth(host, p.g)) {
      const top = Math.max(...p.top) - host.baseZ;
      tops.set(i, Math.max(tops.get(i) ?? top, top));
    }
  }
  return tops;
}

/**
 * Each LoD2 object's windows (lib/city/windows.ts `windowSpecs`: measured
 * on its walls, on another part of its building, on the nearest building
 * of its kind, or its type's) and the storey they keep, snapped to its
 * eave — written into its row (`windows`, `storeyH`); its ground floor's
 * over its plinth.
 */
export function assignWindows(
  objects: CityObjectRow[],
  keys: readonly string[],
  extra: readonly WindowExtra[],
  walls: readonly WindowWall[],
  plinths: readonly PlinthFeature[] = []
): void {
  const index = new Map(keys.map((id, i) => [id, i]));
  const tops = plinthTops(objects, plinths, index);
  const hosts: WindowHost[] = objects.map((o, i) => ({
    centre: footprintCentre(o.footprints),
    eaveH: o.eaveH,
    flat: hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF),
    fn: extra[i]?.fn,
    levels: extra[i]?.levels ?? false,
    lod2: (o.source ?? OBJECT_SOURCE_LOD2) === OBJECT_SOURCE_LOD2,
    ownFacade:
      (extra[i]?.monumental ?? false) || (o.flags & NO_WINDOW_FLAGS) !== 0,
    plinth: tops.get(i),
    root: o.root,
    shop: hasObjectFlag(o.flags, OBJECT_FLAG_SHOP),
    storeyH: o.storeyH,
  }));
  windowSpecs(hosts, walls, index).forEach((choice, i) => {
    if (choice.spec.axis > 0) {
      objects[i].windows = choice.spec;
      objects[i].storeyH = cm(choice.storey);
    }
  });
}

/**
 * Where on its wall each vertex of a window-carrying object lies (lib/city/
 * windows.ts `facadeAttribute`), with OSM's doors and the shopfronts on
 * those walls.
 */
function facadeOf(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  keys: readonly string[],
  onWalls: {
    doors?: readonly DoorFeature[];
    shopfronts?: readonly ShopfrontWall[];
  }
): Int16Array<ArrayBuffer> {
  const { cx, cy } = baked.offset;
  const index = new Map(keys.map((id, i) => [id, i]));
  const doors = (onWalls.doors ?? []).flatMap((f) => {
    const p = f.properties;
    const object = p ? index.get(p.of) : undefined;
    if (!p || object === undefined) {
      return [];
    }
    const [x, y] = f.geometry.coordinates;
    return [
      {
        object,
        at: [x - cx, y - cy] as [number, number],
        n: [p.nx, p.ny] as [number, number],
        w: p.w,
      },
    ];
  });
  const shops = (onWalls.shopfronts ?? []).flatMap((w) => {
    const object = index.get(w.oid);
    return object === undefined
      ? []
      : [
          {
            object,
            a: [w.a[0] - cx, w.a[1] - cy] as [number, number],
            b: [w.b[0] - cx, w.b[1] - cy] as [number, number],
            n: w.n,
          },
        ];
  });
  return facadeAttribute(
    baked.vertices,
    (i) => (baked.objects[i]?.windows?.axis ?? 0) > 0,
    doors,
    shops
  );
}
