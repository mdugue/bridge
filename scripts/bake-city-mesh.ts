/**
 * Parses one tile's CityJSON into the building mesh the viewer streams (as
 * glTF, scripts/bake-tiles.ts): runs cityjson-threejs-loader once, then
 * folds in everything the clay style needs per building (tints, roof colour
 * incl. the DOP LUT, storey/eave heights, dusk glow, roughness jitter), the
 * demolish tree and the minimap footprints. Called by
 * scripts/prepare-data.ts; no DOM.
 */
import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import type { BufferGeometry, Matrix4, Mesh } from "three";
import {
  buildingGlows,
  buildingTint,
  type RoofColorLut,
  roofColor,
  roughJitter,
  nightLight,
  storeyHeight,
} from "../lib/city/building-tint";
import type { CityObjectRow } from "../lib/city/city-mesh";
import { epsgCodeFromReferenceSystem } from "../lib/city/crs";
import { buildingFootprintPolys } from "../lib/city/minimap";
import { recenterOffset } from "../lib/city/recenter";
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
 * Parses and annotates one tile. `sharedMatrix` is the spawn tile's
 * recenter matrix (null for the primary itself), exactly as the browser
 * used to pass it, so every tile lands in the same recentered frame.
 */
export function bakeCityMesh(
  tile: string,
  doc: CityJsonDocument,
  roofLut: RoofColorLut | undefined,
  sharedMatrix: Matrix4 | null
): BakedCityMesh {
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
    const attrs = o.attributes ?? {};
    const root = rootOf(doc, keys, index);
    // A BuildingPart carries no function of its own (7 k of them here, the
    // Frauenkirche among them): its use is its building's.
    const use = {
      function:
        attrs.function ?? doc.CityObjects[keys[root]]?.attributes?.function,
    };
    const baseZ = minZ.get(index) ?? 0;
    const total = (maxZ.get(index) ?? baseZ) - baseZ;
    const measured =
      typeof attrs.measuredHeight === "number" ? attrs.measuredHeight : total;
    const roofMin = roofMinZ.get(index);
    const footprints = buildingFootprintPolys({
      ...doc,
      CityObjects: { [id]: o },
    }).map((p) => p.pts.map(([x, y]): [number, number] => [cm(x), cm(y)]));
    return {
      building: o.type === "Building",
      root,
      baseZ: cm(baseZ),
      eaveH: cm(roofMin === undefined ? total : Math.max(roofMin - baseZ, 0)),
      storeyH: cm(storeyHeight(measured)),
      glow: buildingGlows(use) ? 1 : 0,
      night: nightLight(use),
      rough: r3(roughJitter(id)),
      tint: rgb(buildingTint(id, attrs)),
      roof: rgb(roofColor(id, attrs, roofLut)),
      footprints,
    };
  });

  return { epsg, matrix, objects, offset, vertices: v };
}
