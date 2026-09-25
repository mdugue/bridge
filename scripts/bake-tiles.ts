/**
 * Builds a tile's streamed content (lib/city/tileset.ts): the terrain mesh
 * per level from the DGM GeoTIFF — the fine level an error-bounded TIN over
 * the native DGM, the coarse one a grid with the OSM retaining walls burned
 * in as breaklines; both with the ground lowered under the OSM stairs — and
 * the building mesh from the CityJSON, both as glTF
 * (scripts/tile-glb.ts). Everything the browser used to compute at load —
 * resampling, conflation, the grid, normals — happens here once. Called by
 * scripts/prepare-data.ts, which owns paths, caching and publishing; no DOM.
 */
import { fromArrayBuffer } from "geotiff";
import { BufferAttribute, BufferGeometry } from "three";
import { objectTable } from "../lib/city/city-mesh";
import {
  axisMiddle,
  burnStairs,
  raiseTerraces,
  stairColors,
  type StairLine,
  stairGeometry,
  type Terrace,
} from "../lib/city/stairs";
import { ownsPoint } from "../lib/city/tileset";
import { conflateWalls, type WallLine } from "../lib/city/terrain-conflate";
import {
  type WallOptions,
  type WallRibbon,
  wallGeometry,
} from "../lib/city/walls";
import { kerbGeometry } from "../lib/city/kerbs";
import type { Point2 } from "../lib/city/polyline";
import {
  buildTerrainGeometryData,
  sampleHeightfield,
  type TerrainBounds,
} from "../lib/city/terrain-geometry";
import {
  buildTinGeometryData,
  type TerrainTin,
  TinIndex,
  tinSurface,
} from "../lib/city/terrain-tin";
import { tfwToBounds } from "../lib/city/tfw";
import type { BakedCityMesh } from "./bake-city-mesh";
import { tinFromGrid } from "./bake-terrain-tin";
import type { MeshInput, PropertyTable } from "./tile-glb";

/** True when getBoundingBox() returned pixel indices instead of map units. */
function isPixelSpaceBounds(
  bounds: number[],
  width: number,
  height: number
): boolean {
  const [minX, minY, maxX, maxY] = bounds;
  return (
    Math.abs(minX) <= 1 &&
    Math.abs(minY) <= 1 &&
    Math.abs(maxX - width) <= 1 &&
    Math.abs(maxY - height) <= 1
  );
}

export interface Dgm {
  bounds: TerrainBounds;
  /** n·n elevations, row 0 = north; NoData is NaN */
  elevations: Float32Array;
  n: number;
}

/**
 * The DGM resampled (bilinear) to n×n, or read as it is (`"native"`: DGM1's
 * 1 m grid, for the fine level's TIN). geotiff.js cannot read .tfw
 * sidecars, so a GeoTIFF without embedded georeferencing is placed by its
 * sidecar's text instead — and one with neither fails loudly.
 */
export async function readDgm(
  tif: ArrayBuffer,
  tfw: string | null,
  size: number | "native"
): Promise<Dgm> {
  const image = await (await fromArrayBuffer(tif)).getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (size === "native" && width !== height) {
    throw new Error(
      `DGM: a native read needs a square raster, got ${width}×${height}`
    );
  }
  const n = size === "native" ? width : size;
  let embedded: number[] | null = null;
  try {
    embedded = image.getBoundingBox();
  } catch {
    embedded = null;
  }
  let bounds: TerrainBounds;
  if (embedded && !isPixelSpaceBounds(embedded, width, height)) {
    bounds = embedded as TerrainBounds;
  } else if (tfw !== null) {
    bounds = tfwToBounds(tfw, width, height);
  } else {
    throw new Error(
      "DGM GeoTIFF has no embedded georeferencing and no readable .tfw sidecar. " +
        "Re-run `bun run fetch` (it writes the georeferencing), or embed it: gdal_translate -a_srs EPSG:<the provider's CRS> in.tif out.tif"
    );
  }
  const raster = await image.readRasters(
    size === "native"
      ? { samples: [0], interleave: true }
      : {
          width: n,
          height: n,
          samples: [0],
          interleave: true,
          resampleMethod: "bilinear",
        }
  );
  if (!ArrayBuffer.isView(raster)) {
    throw new Error("unexpected raster shape (expected one interleaved band)");
  }
  const noData = image.getGDALNoData();
  const elevations = new Float32Array(n * n);
  for (let i = 0; i < elevations.length; i++) {
    const z = Number((raster as unknown as ArrayLike<number>)[i]);
    elevations[i] = noData !== null && z === noData ? Number.NaN : z;
  }
  return { bounds, elevations, n };
}

/** Flat or smooth vertex normals, as three computes them. */
function normalsOf(
  positions: Float32Array,
  indices?: Uint32Array
): Float32Array {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  if (indices) {
    geometry.setIndex(new BufferAttribute(indices, 1));
  }
  geometry.computeVertexNormals();
  return geometry.getAttribute("normal").array as Float32Array;
}

/**
 * A terrain mesh's normals from its SURFACE triangles alone. The skirt shares
 * the border vertices with the surface, and a 30 m vertical wall outweighs the
 * ground's triangles in three's area-weighted average: the border normals came
 * out nearly horizontal and lit a bright band along every tile seam, one
 * triangle wide (on a TIN's flat road, metres). The skirt's bottom ring faces
 * straight up, so a glimpse of it reads as ground.
 */
function terrainNormals(
  positions: Float32Array,
  indices: Uint32Array,
  surfaceIndexCount: number,
  surfaceVertexCount: number
): Float32Array {
  const normals = normalsOf(positions, indices.subarray(0, surfaceIndexCount));
  for (let i = surfaceVertexCount; i < positions.length / 3; i++) {
    normals[3 * i] = 0;
    normals[3 * i + 1] = 0;
    normals[3 * i + 2] = 1;
  }
  return normals;
}

export interface TerrainMesh {
  /** ground height at projected (EPSG) x, y over the very triangles the
   *  mesh draws — what the walls and kerbs stand on; null off the tile */
  heightAt: (x: number, y: number) => number | null;
  input: Omit<MeshInput, "extras" | "name">;
  minElevation: number;
  maxElevation: number;
  /** set when the mesh is a TIN (TerrainExtras.tin), absent for the grid */
  tin?: { maxError: number; triangles: number };
}

/** What the terrain bake shapes the DGM with besides the walls. */
export interface TerrainFeatures {
  stairs?: StairLine[];
  terraces?: Terrace[];
}

/**
 * The DGM shaped in three passes: the walls burned in as steps
 * (lib/city/terrain-conflate.ts; the grid only — a TIN keeps the measured
 * ramps and the wall ribbons snap to them), the raised areas the DGM lacks
 * lifted to their level, then the ground under each flight of stairs lowered
 * below its treads (lib/city/stairs.ts), `stairMargin` deeper for a mesh
 * that only approximates the grid.
 */
function shapeDgm(
  dgm: Dgm,
  walls: WallLine[],
  features: TerrainFeatures,
  opts: { burnWalls: boolean; stairMargin: number }
): Float32Array {
  const { n, bounds } = dgm;
  const { stairs = [], terraces = [] } = features;
  let elevations: Float32Array = dgm.elevations;
  if (opts.burnWalls && walls.length > 0) {
    elevations = conflateWalls({ elevations, n, bounds, walls });
  }
  if (terraces.length > 0) {
    elevations = raiseTerraces({ elevations, n, bounds, terraces });
  }
  if (stairs.length > 0) {
    const lines = walls.map((w) => w.coords);
    elevations = burnStairs({
      elevations,
      n,
      bounds,
      stairs,
      walls: lines,
      margin: opts.stairMargin,
    });
  }
  return elevations;
}

/** The highest surface vertex of the first `count`. */
function maxZ(positions: Float32Array, count: number): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    max = Math.max(max, positions[i * 3 + 2]);
  }
  return max;
}

/**
 * The terrain grid (+ its 30 m skirt) in the recentered frame, the DGM
 * shaped by `shapeDgm` with the walls burned in. The first n·n vertices are
 * the grid, row 0 = north: the runtime samples ground height straight from
 * them.
 */
export function terrainMesh(
  dgm: Dgm,
  walls: WallLine[],
  offset: { cx: number; cy: number },
  features: TerrainFeatures = {}
): TerrainMesh {
  const { n, bounds } = dgm;
  const elevations = shapeDgm(dgm, walls, features, {
    burnWalls: true,
    stairMargin: 0,
  });
  const { positions, indices, minElevation, surfaceIndexCount } =
    buildTerrainGeometryData({ elevations, n, bounds, offset });
  const index = Uint32Array.from(indices);
  return {
    heightAt: (x, y) => sampleHeightfield({ elevations, n, bounds }, x, y),
    input: {
      positions,
      normals: terrainNormals(positions, index, surfaceIndexCount, n * n),
      indices: index,
    },
    minElevation,
    maxElevation: maxZ(positions, n * n),
  };
}

/**
 * The fine level as an error-bounded TIN (+ skirt) over the NATIVE DGM
 * (scripts/bake-terrain-tin.ts): terraces and stairs shaped in, the walls
 * not — their ribbons snap to the measured step (lib/city/walls.ts). The
 * stairs are burned `maxError` deeper, so no tread is pierced by a triangle
 * that only approximates the burned grid. The glTF writer reorders it for
 * meshopt (nothing reads a TIN's order: its skirt triangles are vertical,
 * so a ground-height lookup skips them). Null when the DGM has NoData (a TIN
 * has no holes): the caller falls back to the grid.
 */
export function tinTerrainMesh(
  dgm: Dgm,
  walls: WallLine[],
  offset: { cx: number; cy: number },
  features: TerrainFeatures,
  maxError: number
): TerrainMesh | null {
  const elevations = shapeDgm(dgm, walls, features, {
    burnWalls: false,
    stairMargin: maxError,
  });
  let tin: TerrainTin;
  try {
    tin = tinFromGrid(elevations, dgm.n, dgm.bounds, maxError);
  } catch {
    return null;
  }
  const { positions, indices, minElevation, surfaceIndexCount } =
    buildTinGeometryData(tin, offset);
  const index = new TinIndex(tinSurface(tin));
  return {
    heightAt: (x, y) => index.heightAt(x, y),
    input: {
      positions,
      normals: terrainNormals(
        positions,
        indices,
        surfaceIndexCount,
        tin.z.length
      ),
      indices,
      reorder: true,
    },
    minElevation,
    maxElevation: maxZ(positions, tin.z.length),
    tin: { maxError, triangles: tin.triangles.length / 3 },
  };
}

/** World frame (Y-up) → the recentered data frame (Z-up) the glTF writer
 *  takes: (x, y, z) → (x, −z, y). */
function worldToData(xyz: number[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(xyz.length);
  for (let i = 0; i < xyz.length; i += 3) {
    out[i] = xyz[i];
    out[i + 1] = -xyz[i + 2];
    out[i + 2] = xyz[i + 1];
  }
  return out;
}

/**
 * The flights of stairs this tile owns (the tile owning a flight's middle
 * stands it; a flight across a seam is burned into both terrains) as one
 * mesh: treads, risers and cheeks with their stone shades as vertex colours
 * (lib/city/stairs.ts). Null when the tile owns none.
 */
export function stairMesh(
  stairs: StairLine[],
  offset: { cx: number; cy: number },
  bounds: TerrainBounds
): Omit<MeshInput, "children" | "extras" | "table" | "weld"> | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const kinds: number[] = [];
  for (const stair of stairs) {
    const [x, y] = axisMiddle(stair.coords);
    const data = ownsPoint(bounds, x, y) ? stairGeometry(stair, offset) : null;
    if (data) {
      positions.push(...data.positions);
      normals.push(...data.normals);
      kinds.push(...data.kinds);
    }
  }
  if (positions.length === 0) {
    return null;
  }
  return {
    name: "stairs",
    positions: worldToData(positions),
    normals: worldToData(normals),
    colors: stairColors(kinds),
  };
}

/**
 * The tile's walls as one ribbon mesh, standing on `heightAt` — the final
 * fine ground of every tile of the site, so a wall near a seam reads its
 * neighbour's; on TIN ground (`snapToStep`) an earth-retaining wall snaps to
 * the measured step. Null when no wall stands.
 */
export function wallMesh(
  walls: WallRibbon[],
  heightAt: (x: number, y: number) => number | null,
  offset: { cx: number; cy: number },
  opts: WallOptions = {}
): Omit<MeshInput, "children" | "extras" | "table" | "weld"> | null {
  const data = wallGeometry(walls, heightAt, offset, opts);
  return data
    ? {
        name: "walls",
        positions: worldToData(data.positions),
        normals: worldToData(data.normals),
      }
    : null;
}

/**
 * The tile's kerb stones as one mesh, standing on `heightAt` — the final
 * shaped ground (lib/city/kerbs.ts).
 */
export function kerbMesh(
  lines: Point2[][],
  heightAt: (x: number, y: number) => number | null,
  offset: { cx: number; cy: number }
): Omit<MeshInput, "children" | "extras" | "table" | "weld"> | null {
  const data = kerbGeometry(lines, heightAt, offset);
  return data
    ? {
        name: "kerbs",
        positions: worldToData(data.positions),
        normals: worldToData(data.normals),
      }
    : null;
}

export interface CityMesh {
  /** per-object minimap footprints (EPSG) */
  footprints: [number, number][][][];
  input: Omit<MeshInput, "extras" | "name">;
  maxElevation: number;
}

/**
 * The building mesh with its property table: flat normals from the
 * non-indexed stream, then welded (vertices of equal position, normal,
 * object and roof flag merge — never across objects).
 */
export function cityMesh(baked: BakedCityMesh): CityMesh {
  const v = baked.vertices;
  const t = objectTable(baked.objects);
  const table: PropertyTable = {
    className: "building",
    count: t.count,
    properties: {
      baseZ: { type: "SCALAR", componentType: "FLOAT32", values: t.baseZ },
      building: { type: "SCALAR", componentType: "UINT8", values: t.building },
      eaveH: { type: "SCALAR", componentType: "FLOAT32", values: t.eaveH },
      glow: { type: "SCALAR", componentType: "UINT8", values: t.glow },
      roof: { type: "VEC3", componentType: "FLOAT32", values: t.roof },
      root: { type: "SCALAR", componentType: "UINT32", values: t.root },
      rough: { type: "SCALAR", componentType: "FLOAT32", values: t.rough },
      storeyH: { type: "SCALAR", componentType: "FLOAT32", values: t.storeyH },
      tint: { type: "VEC3", componentType: "FLOAT32", values: t.tint },
    },
  };
  let maxElevation = Number.NEGATIVE_INFINITY;
  for (let i = 2; i < v.positions.length; i += 3) {
    maxElevation = Math.max(maxElevation, v.positions[i]);
  }
  return {
    footprints: baked.objects.map((o) => o.footprints),
    input: {
      positions: v.positions,
      normals: normalsOf(v.positions),
      attributes: { _FEATURE_ID_0: v.objectIds, _ROOF: v.isRoof },
      table,
      weld: true,
    },
    maxElevation,
  };
}
