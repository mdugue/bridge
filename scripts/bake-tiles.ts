/**
 * Builds a tile's streamed content (lib/city/tileset.ts): the terrain mesh
 * per level from the DGM GeoTIFF (with the OSM retaining walls burned in as
 * breaklines) and the building mesh from the CityJSON, both as glTF
 * (scripts/tile-glb.ts). Everything the browser used to compute at load —
 * resampling, conflation, the grid, normals — happens here once. Called by
 * scripts/prepare-data.ts, which owns paths, caching and publishing; no DOM.
 */
import { fromArrayBuffer } from "geotiff";
import { BufferAttribute, BufferGeometry } from "three";
import { objectTable } from "../lib/city/city-mesh";
import { conflateWalls, type WallLine } from "../lib/city/terrain-conflate";
import {
  buildTerrainGeometryData,
  type TerrainBounds,
} from "../lib/city/terrain-geometry";
import { tfwToBounds } from "../lib/city/tfw";
import type { BakedCityMesh } from "./bake-city-mesh";
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
 * The DGM resampled (bilinear) to n×n. geotiff.js cannot read .tfw
 * sidecars, so a GeoTIFF without embedded georeferencing is placed by its
 * sidecar's text instead — and one with neither fails loudly.
 */
export async function readDgm(
  tif: ArrayBuffer,
  tfw: string | null,
  n: number
): Promise<Dgm> {
  const image = await (await fromArrayBuffer(tif)).getImage();
  const width = image.getWidth();
  const height = image.getHeight();
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
        "Embed it with: gdal_translate -a_srs EPSG:25833 in.tif out.tif"
    );
  }
  const raster = await image.readRasters({
    width: n,
    height: n,
    samples: [0],
    interleave: true,
    resampleMethod: "bilinear",
  });
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

export interface TerrainMesh {
  input: Omit<MeshInput, "extras" | "name">;
  minElevation: number;
  maxElevation: number;
}

/**
 * The terrain grid (+ its 30 m skirt) with the walls burned in as steps
 * (lib/city/terrain-conflate.ts), in the recentered frame. The first n·n
 * vertices are the grid, row 0 = north: the runtime samples ground height
 * straight from them.
 */
export function terrainMesh(
  dgm: Dgm,
  walls: WallLine[],
  offset: { cx: number; cy: number }
): TerrainMesh {
  const { n, bounds } = dgm;
  const elevations =
    walls.length > 0
      ? conflateWalls({ elevations: dgm.elevations, n, bounds, walls })
      : dgm.elevations;
  const { positions, indices, minElevation } = buildTerrainGeometryData({
    elevations,
    n,
    bounds,
    offset,
  });
  const index = Uint32Array.from(indices);
  let maxElevation = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n * n; i++) {
    maxElevation = Math.max(maxElevation, positions[i * 3 + 2]);
  }
  return {
    input: { positions, normals: normalsOf(positions, index), indices: index },
    minElevation,
    maxElevation,
  };
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
