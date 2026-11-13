/**
 * The building bake's first step (scripts/bake-city-mesh.ts): the LoD2
 * model as cityjson-threejs-loader parses it, gathered into one vertex
 * stream (scripts/vertex-stream.ts) with its roof flags (`withRoofSteps`)
 * and each roof face's own colour (`withFaceRoofColours`), and the frame a
 * tile is recentered in (`cityFrame`). No DOM.
 */
import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import type { Matrix4, Mesh, BufferGeometry } from "three";
import type { RoofColours } from "../lib/city/building-tint";
import { epsgCodeFromReferenceSystem } from "../lib/city/crs";
import { recenterOffset } from "../lib/city/recenter";
import type { CityJsonDocument } from "../lib/city/types";
import type { CityVertices } from "./vertex-stream";

/** WallSurface and RoofSurface in the loader's fixed `defaultSemanticsColors` order. */
const WALL_SURFACE_TYPE = 1;
const ROOF_SURFACE_TYPE = 2;
/** A wall at most this tall (m) standing on its building's roof is the
 *  roof's: a step between two roof levels, a parapet, a dormer's cheek. */
const ROOF_STEP_M = 1.5;

/** Concatenates the loader's chunk meshes into one vertex stream. */
export function collectVertices(loaderScene: {
  traverse: (cb: (o: unknown) => void) => void;
}): CityVertices {
  const chunks: {
    objectid: ArrayLike<number>;
    position: ArrayLike<number>;
    surfacetype: ArrayLike<number> | undefined;
    geometryid: ArrayLike<number> | undefined;
    boundaryid: ArrayLike<number> | undefined;
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
      geometryid: geom.attributes.geometryid?.array,
      boundaryid: geom.attributes.boundaryid?.array,
    });
  });
  const n = chunks.reduce((s, c) => s + c.objectid.length, 0);
  const walls = new Uint8Array(n);
  const out = {
    positions: new Float32Array(n * 3),
    objectIds: new Float32Array(n),
    isRoof: new Float32Array(n),
    surfaces: new Float32Array(n * 2).fill(-1),
  };
  let at = 0;
  for (const c of chunks) {
    const count = c.objectid.length;
    for (let i = 0; i < count; i += 1) {
      out.positions[(at + i) * 3] = c.position[i * 3];
      out.positions[(at + i) * 3 + 1] = c.position[i * 3 + 1];
      out.positions[(at + i) * 3 + 2] = c.position[i * 3 + 2];
      out.objectIds[at + i] = c.objectid[i];
      const surface = c.surfacetype ? c.surfacetype[i] : -1;
      out.isRoof[at + i] = surface === ROOF_SURFACE_TYPE ? 1 : 0;
      walls[at + i] = surface === WALL_SURFACE_TYPE ? 1 : 0;
      out.surfaces[(at + i) * 2] = c.geometryid?.[i] ?? -1;
      out.surfaces[(at + i) * 2 + 1] = c.boundaryid?.[i] ?? -1;
    }
    at += count;
  }
  out.isRoof = withRoofSteps(out, walls);
  return out;
}

/**
 * The roof flags with every short wall that stands on its building's roof
 * flagged too: a step between roof levels, a parapet or a dormer's cheek
 * is clad like the roof, and drawn as a wall, sunlit plaster with an
 * eave stroke, it read from above as a white dash across the roof (the
 * Altstadt's flat roofs). A wall is one surface (`surfaces`: geometry and
 * boundary ids) at most ROOF_STEP_M tall whose foot is no lower than the
 * building's lowest roof vertex; a set-back storey is taller and keeps
 * its windows. A gable is not: a triangle (one top corner) standing on a
 * level foot at the eave, where a dataset keeps the gable apart from the
 * wall under it (on a shallow roof 1.5 m or less: Meißen's tile 362 of
 * them at least 5 m wide, Dresden's spawn tile 173).
 */
export function withRoofSteps(
  v: Pick<CityVertices, "positions" | "objectIds" | "isRoof" | "surfaces">,
  walls: Uint8Array
): Float32Array<ArrayBuffer> {
  const isRoof = Float32Array.from(v.isRoof);
  const ids = v.surfaces;
  if (!ids) {
    return isRoof;
  }
  const p = v.positions;
  // one number per surface (object, geometry, boundary; −1 is none, so
  // each id + 1): objects below 2¹⁹, geometries 2¹⁰, boundaries 2²⁴
  const key = (i: number) =>
    (v.objectIds[i] * 1024 + ids[2 * i] + 1) * 16_777_216 + ids[2 * i + 1] + 1;
  const eave = new Map<number, number>();
  const shape = new Map<number, WallShape>();
  for (let i = 0; i < isRoof.length; i += 1) {
    const z = p[3 * i + 2];
    if (isRoof[i] === 1) {
      eave.set(v.objectIds[i], Math.min(eave.get(v.objectIds[i]) ?? z, z));
    } else if (walls[i] === 1) {
      const s = shape.get(key(i));
      if (s) {
        s.lo = Math.min(s.lo, z);
        s.hi = Math.max(s.hi, z);
      } else {
        shape.set(key(i), { lo: z, hi: z, top: null, foot: null });
      }
    }
  }
  for (let i = 0; i < isRoof.length; i += 1) {
    const s = walls[i] === 1 ? shape.get(key(i)) : undefined;
    if (s) {
      const z = p[3 * i + 2];
      if (z > s.hi - CORNER_M) {
        s.top = corners(s.top, p[3 * i], p[3 * i + 1]);
      }
      if (z < s.lo + CORNER_M) {
        s.foot = corners(s.foot, p[3 * i], p[3 * i + 1]);
      }
    }
  }
  for (let i = 0; i < isRoof.length; i += 1) {
    const s = walls[i] === 1 ? shape.get(key(i)) : undefined;
    const low = eave.get(v.objectIds[i]);
    if (
      s &&
      low !== undefined &&
      s.hi - s.lo <= ROOF_STEP_M &&
      s.lo >= low - 0.1 &&
      !isGable(s, low)
    ) {
      isRoof[i] = 1;
    }
  }
  return isRoof;
}

/** How close two corners (m) are one corner, and two heights one level. */
const CORNER_M = 0.05;

/** A wall surface's height span and its distinct corners at the top and
 *  at the foot (the first one's x, y and whether another stands apart). */
interface WallShape {
  lo: number;
  hi: number;
  top: Corners | null;
  foot: Corners | null;
}
interface Corners {
  x: number;
  y: number;
  more: boolean;
}

function corners(c: Corners | null, x: number, y: number): Corners {
  if (!c) {
    return { x, y, more: false };
  }
  if (!c.more && Math.hypot(x - c.x, y - c.y) > CORNER_M) {
    c.more = true;
  }
  return c;
}

/** One top corner over a level foot of two at the building's eave. */
function isGable(s: WallShape, eave: number): boolean {
  return (
    s.top !== null &&
    !s.top.more &&
    s.foot !== null &&
    s.foot.more &&
    Math.abs(s.lo - eave) < CORNER_M
  );
}

/**
 * The stream with each LoD2 roof vertex's own face colour (`roofRgb`)
 * where the roof colour bake read the face apart from its building
 * (`RoofColours.faces`, keyed by the loader's geometry and surface ids).
 */
export function withFaceRoofColours(
  v: CityVertices,
  keys: readonly string[],
  faces: RoofColours["faces"] | undefined
): CityVertices {
  if (!(faces && v.surfaces)) {
    return v;
  }
  const byObject = new Map<number, Map<string, readonly number[]>>();
  for (let index = 0; index < keys.length; index += 1) {
    const id = keys[index];
    const list = faces[id];
    if (list?.length) {
      byObject.set(
        index,
        new Map(list.map((f) => [`${f[0]}:${f[1]}`, f.slice(2, 5)]))
      );
    }
  }
  const count = v.objectIds.length;
  const roofRgb = new Float32Array(3 * count).fill(Number.NaN);
  for (let i = 0; i < count; i += 1) {
    const own = byObject.get(v.objectIds[i]);
    const c =
      v.isRoof[i] === 1
        ? own?.get(`${v.surfaces[2 * i]}:${v.surfaces[2 * i + 1]}`)
        : undefined;
    if (c?.length === 3) {
      roofRgb.set(c, 3 * i);
    }
  }
  return { ...v, roofRgb };
}

/** Climbs `parents` to the root of an object's building tree (cycle-guarded). */
export function rootOf(
  doc: CityJsonDocument,
  keys: string[],
  index: number
): number {
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

/** A tile's CRS, from its CityJSON's metadata; anything but ETRS89/UTM
 *  fails. */
export function epsgOf(tile: string, doc: CityJsonDocument): number {
  const epsg = epsgCodeFromReferenceSystem(doc.metadata?.referenceSystem);
  if (epsg === null) {
    throw new Error(
      `Unsupported CityJSON CRS "${doc.metadata?.referenceSystem}" in ${tile} — ` +
        "expected ETRS89/UTM (EPSG:25832 or 25833)."
    );
  }
  return epsg;
}

/** The frame a tile's buildings are recentered in. */
export interface CityFrame {
  epsg: number;
  /** the recenter matrix (`bakeCityMesh`'s `sharedMatrix`) */
  matrix: Matrix4;
  offset: { cx: number; cy: number };
}

/**
 * The frame `bakeCityMesh` recenters a tile in when it is given none — the
 * loader's translation to the centre of the vertices' bounding box — without
 * parsing a building: the loader reads the document's vertices alone. The
 * spawn tile's frame is all the other tiles need of it.
 */
export function cityFrame(tile: string, source: CityJsonDocument): CityFrame {
  const epsg = epsgOf(tile, source);
  const loader = new CityJSONLoader(new CityJSONParser());
  loader.load({ ...source, CityObjects: {} });
  return { epsg, matrix: loader.matrix, offset: recenterOffset(loader.matrix) };
}

/** Per-object vertex scans: base (lowest Z), top and lowest ROOF vertex. */
export function objectHeights(v: CityVertices): {
  maxZ: Map<number, number>;
  minZ: Map<number, number>;
  roofMinZ: Map<number, number>;
} {
  const minZ = new Map<number, number>();
  const maxZ = new Map<number, number>();
  const roofMinZ = new Map<number, number>();
  for (let i = 0; i < v.objectIds.length; i += 1) {
    const idx = v.objectIds[i];
    const z = v.positions[i * 3 + 2];
    minZ.set(idx, Math.min(minZ.get(idx) ?? z, z));
    maxZ.set(idx, Math.max(maxZ.get(idx) ?? z, z));
    if (v.isRoof[i] === 1) {
      roofMinZ.set(idx, Math.min(roofMinZ.get(idx) ?? z, z));
    }
  }
  return { minZ, maxZ, roofMinZ };
}
