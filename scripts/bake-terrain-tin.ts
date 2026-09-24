/**
 * Bakes one DGM GeoTIFF into an error-bounded terrain TIN
 * (lib/city/terrain-tin.ts) — the ground the viewer meshes, in place of the
 * regular heightfield (bake-heightfield.ts). The raster is read at its NATIVE
 * resolution (DGM1: 1 m, 2000²) rather than resampled to 1024², then
 * Delatin inserts the worst-fitting grid point until every grid point lies
 * within `maxError` of the mesh. Flat ground (the Elbe, squares, meadows)
 * collapses to a few large triangles and the budget goes where the ground
 * bends: a retaining wall keeps the 1–2 m ramp the DGM1 has instead of the
 * ~3 m the 1024² resample smears it into.
 *
 * No wall conflation here: the terrain study (scripts/terrain-study/,
 * docs/transformations.md "Terrain TIN") measured the heightfield breakline
 * burn against the laser scan and it triples the error in the 20 m band
 * around walls — it flattens terraced walls (the Jungfernbastei steps
 * 108.6 → 117.4 → 119.7 → 121.1 m) into one cliff at the top level. On the
 * sharper native DGM1 the wall layer snaps its ribbon to the measured step
 * instead (lib/city/wall-snap.ts).
 *
 * Called by scripts/prepare-data.ts; no DOM, no filesystem.
 */
import { gzipSync } from "node:zlib";
import Delatin from "delatin";
import { fromArrayBuffer } from "geotiff";
import {
  encodeTerrainTin,
  type TerrainTinHeader,
} from "../lib/city/terrain-tin";
import { resolveBounds } from "./bake-heightfield";

export interface BakedTerrainTin {
  /** the gzipped payload (the `.bin.gz` artifact) */
  data: Buffer;
  /** the header minus its `data` sibling name, which the publisher assigns */
  header: Omit<TerrainTinHeader, "data">;
  /** bake wall time (ms), for the log line */
  ms: number;
}

/** Refines a Delatin mesh over an n×n grid to `maxError` and encodes it. */
export function tinFromGrid(
  grid: ArrayLike<number>,
  n: number,
  bounds: TerrainTinHeader["bounds"],
  maxError: number
): { data: Buffer; header: Omit<TerrainTinHeader, "data"> } {
  for (let i = 0; i < grid.length; i++) {
    if (!Number.isFinite(grid[i])) {
      throw new Error("terrain TIN: the source grid has NoData");
    }
  }
  const mesher = new Delatin(grid, n, n);
  mesher.run(maxError);
  const encoded = encodeTerrainTin({
    bounds,
    n,
    coords: mesher.coords,
    triangles: mesher.triangles,
    heightAt: (x, y) => grid[y * n + x],
    maxError,
  });
  return { data: gzipSync(encoded.data, { level: 9 }), header: encoded.header };
}

/**
 * Reads the GeoTIFF in `tif` at its native resolution and bakes the TIN.
 * `tfw` is the sidecar's text (null when absent), consulted only when the
 * GeoTIFF carries no georeferencing of its own. The raster must be square
 * and free of NoData (a tile with holes keeps the heightfield).
 */
export async function bakeTerrainTin(
  tif: ArrayBuffer,
  tfw: string | null,
  maxError: number
): Promise<BakedTerrainTin> {
  const t0 = performance.now();
  const tiff = await fromArrayBuffer(tif);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (width !== height) {
    throw new Error(
      `terrain TIN needs a square raster, got ${width}×${height}`
    );
  }
  let embedded: number[] | null = null;
  try {
    embedded = image.getBoundingBox();
  } catch {
    embedded = null;
  }
  const bounds = resolveBounds(embedded, width, height, tfw);
  const raster = await image.readRasters({ samples: [0], interleave: true });
  if (!ArrayBuffer.isView(raster)) {
    throw new Error("unexpected raster shape (expected one interleaved band)");
  }
  const nodata = image.getGDALNoData();
  const grid = new Float64Array(width * height);
  const src = raster as unknown as ArrayLike<number>;
  for (let i = 0; i < grid.length; i++) {
    grid[i] = nodata !== null && src[i] === nodata ? Number.NaN : src[i];
  }
  const baked = tinFromGrid(grid, width, bounds, maxError);
  return { ...baked, ms: performance.now() - t0 };
}
