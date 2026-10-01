/**
 * Parses one tile's CityJSON into the building mesh the viewer streams (as
 * glTF, scripts/bake-tiles.ts): runs cityjson-threejs-loader once, then
 * folds in everything the clay style needs per building (tints, roof colour
 * incl. the DOP LUT, storey/eave heights, dusk glow, roughness jitter), the
 * OSM flags (shop, heritage; a part carries its Building's too), the
 * demolish tree and the minimap footprints, then appends the small
 * structures the laser scan saw and LoD2 lacks (`appendScanStructures`).
 * An object whose LoD2 roof misses DOM1 wears its measured stepped blocks
 * instead (`withMeasuredRoofs`, scripts/measured-roofs.ts).
 * Called by scripts/prepare-data.ts; no DOM.
 */
import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import type { BufferGeometry, Matrix4, Mesh } from "three";
import {
  buildingGlows,
  buildingTint,
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
  OBJECT_SOURCE_SCAN,
  type OsmBuildingLut,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import { epsgCodeFromReferenceSystem } from "../lib/city/crs";
import type {
  MeasuredRoofFeature,
  SmallBuildingFeature,
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
  };
}

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
  for (const i of keep) {
    positions.push(
      v.positions[i * 3],
      v.positions[i * 3 + 1],
      v.positions[i * 3 + 2]
    );
    objectIds.push(v.objectIds[i]);
    isRoof.push(v.isRoof[i]);
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
  }
  return {
    positions: Float32Array.from(positions),
    objectIds: Float32Array.from(objectIds),
    isRoof: Float32Array.from(isRoof),
  };
}

/**
 * Parses and annotates one tile. `sharedMatrix` is the spawn tile's
 * recenter matrix (null for the primary itself), exactly as the browser
 * used to pass it, so every tile lands in the same recentered frame.
 * `osmLut` holds what OSM knows per object (shops, heritage), when baked;
 * a part carries its own flags and its root Building's. `measured` are
 * the roofs rebuilt from DOM1, when baked.
 */
export function bakeCityMesh(
  tile: string,
  source: CityJsonDocument,
  roofLut: RoofColorLut | undefined,
  sharedMatrix: Matrix4 | null,
  osmLut?: OsmBuildingLut,
  scan?: readonly SmallBuildingFeature[],
  measured?: readonly MeasuredRoofFeature[]
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
    const footprints = footprintsOf[index];
    return {
      building: o.type === "Building",
      root,
      baseZ: cm(baseZ),
      eaveH: cm(roofMin === undefined ? total : Math.max(roofMin - baseZ, 0)),
      flags: inheritedFlags(osmLut?.[id], osmLut?.[keys[root]]),
      storeyH: cm(storeyHeight(measured)),
      glow: buildingGlows(attrs) ? 1 : 0,
      rough: r3(roughJitter(id)),
      tint: rgb(buildingTint(id, attrs)),
      roof: rgb(roofColor(id, attrs, roofLut)),
      footprints,
      facts: lod2Facts({
        buildingId: keys[root],
        own,
        resolved: attrs,
        osm: inheritedOsm(osmLut?.[id], osmLut?.[keys[root]]),
        fallbackHeight: total,
        footprints,
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
          "number"
      );
    }
  }

  const baked = { epsg, matrix, objects, offset, vertices: v };
  if (scan) {
    appendScanStructures(tile, baked, scan);
  }
  return baked;
}
