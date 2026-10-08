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
  OBJECT_SOURCE_SCAN,
  type OsmBuildingLut,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import { epsgCodeFromReferenceSystem } from "../lib/city/crs";
import {
  DOOR_SINK,
  DOOR_SURROUND,
  doorMesh,
  wallShift,
} from "../lib/city/doors";
import { dormerMesh } from "../lib/city/dormers";
import {
  CORNICE,
  corniceMesh,
  plinthMesh,
  type Shaded,
} from "../lib/city/plinths";
import type {
  DoorFeature,
  DormerFeature,
  MeasuredRoofFeature,
  PlinthFeature,
  SmallBuildingFeature,
  StructureFeature,
} from "../lib/city/features";
import { buildingFootprintPolys } from "../lib/city/minimap";
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

/** The mesh as non-indexed triangles, flat per-face vertices. */
export interface CityVertices {
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
 * doors and the surface model's dormers, each on its LoD2 host.
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
  onWalls: {
    doors?: readonly DoorFeature[];
    dormers?: readonly DormerFeature[];
    plinths?: readonly PlinthFeature[];
  } = {}
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
    return {
      building: o.type === "Building",
      root,
      baseZ: cm(baseZ),
      eaveH: cm(eaveH),
      flags: facadeFlags(
        inheritedFlags(osmLut?.[id], osmLut?.[keys[root]]),
        ownFacade(attrs, eaveH, osm?.levels)
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

  const baked = { epsg, matrix, objects, offset, vertices: v };
  markFlatRoofs(objects, v);
  appendBeyondLod2(tile, baked, keys, { ...onWalls, facades, gaps, scan });
  markGrounded(baked.objects);
  return baked;
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

/**
 * The plinths on the LoD2 walls' street side (pipeline/bake/plinths.py),
 * appended as part of the building they carry, like its doors: one object
 * per host in a stone shade of the host's tint, the host's building tree
 * (asking or demolishing it takes the building), no footprint, no storey
 * band or eave line on it, `source` 5. Only a town house carries one: a
 * host from 3 m of wall, standing on the street, not `NO_PLINTH`. Along
 * the same stretches the Gurtgesims over its ground floor (`corniceMesh`,
 * `corniceHeight`): a second object in a plaster shade a touch paler than
 * the wall, level at the first storey line.
 */
export function appendPlinths(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  plinths: readonly PlinthFeature[],
  objectIndex: ReadonlyMap<string, number>
): void {
  const positions: number[] = [];
  const normals: number[] = [];
  const objectIds: number[] = [];
  const part = (
    tris: Shaded,
    host: CityObjectRow,
    base: number,
    top: number,
    tint: [number, number, number]
  ) => {
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
  for (const f of plinths) {
    const p = f.properties;
    const hostIndex = p ? objectIndex.get(p.of) : undefined;
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (!(p && host) || (host.flags & NO_PLINTH) !== 0 || host.eaveH < 3) {
      continue;
    }
    const foot = Math.min(...p.g);
    if (host.baseZ > foot + PLINTH_ON_GROUND_M) {
      continue;
    }
    const top = Math.max(...p.top);
    // close to the wall: the form, not the colour, carries it
    const stone = mixRgb(
      host.tint.map((c) => c * 0.9),
      PLINTH_STONE,
      0.25
    );
    part(plinthMesh(f, baked.offset), host, foot, top, stone);
    const z = corniceHeight(host, top);
    if (z !== undefined) {
      const plaster = mixRgb(host.tint, SURROUND_STONE, 0.08);
      const tris = corniceMesh(f, baked.offset, z);
      part(tris, host, z, z + CORNICE.height + CORNICE.wash, plaster);
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
