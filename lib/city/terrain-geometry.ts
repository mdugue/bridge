/**
 * Pure heightfield math for the DGM terrain. No THREE, no DOM — the WebGL
 * layer wraps the returned arrays in a BufferGeometry.
 *
 * Grid layout: `elevations` is an n x n raster, row-major, row 0 = NORTH
 * (maxY) — the GeoTIFF convention. Vertices sit at pixel centers.
 */

export type TerrainBounds = [number, number, number, number];

export interface TerrainGeometryInput {
  /** [minX, minY, maxX, maxY] in the projected CRS (e.g. EPSG:25833) */
  bounds: TerrainBounds;
  /** n*n elevation samples, row-major, row 0 = north */
  elevations: ArrayLike<number>;
  /** grid size (n x n) */
  n: number;
  /** raster NoData value, if any */
  nodata: number | null;
  /** recenter offset shared with the city (see recenterOffset) */
  offset: { cx: number; cy: number };
}

export interface TerrainGeometryData {
  /** triangle indices; quads touching a NoData vertex are omitted */
  indices: number[];
  /** n*n*3 vertex positions in the recentered data frame (Z-up) */
  positions: Float32Array;
}

/** Elevations below this are treated as NoData even without a nodata tag. */
const MIN_PLAUSIBLE_ELEVATION = -1000;

function isInvalidElevation(z: number, nodata: number | null): boolean {
  return (
    !Number.isFinite(z) ||
    z < MIN_PLAUSIBLE_ELEVATION ||
    (nodata !== null && z === nodata)
  );
}

export function buildTerrainGeometryData(
  input: TerrainGeometryInput
): TerrainGeometryData {
  const { elevations, n, bounds, offset, nodata } = input;
  const [minX, minY, maxX, maxY] = bounds;
  if (maxX <= minX || maxY <= minY) {
    throw new Error(`Degenerate terrain bounds: [${bounds.join(", ")}]`);
  }
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;

  const positions = new Float32Array(n * n * 3);
  const valid = new Uint8Array(n * n);

  let p = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const z = elevations[i];
      const bad = isInvalidElevation(z, nodata);
      valid[i] = bad ? 0 : 1;

      // Pixel centers; raster row 0 = north (maxY).
      positions[p++] = minX + (col + 0.5) * dx - offset.cx;
      positions[p++] = maxY - (row + 0.5) * dy - offset.cy;
      positions[p++] = bad ? 0 : z;
    }
  }

  // Skip quads that touch a NoData vertex: holes instead of spikes.
  const indices: number[] = [];
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      if (valid[a] && valid[b] && valid[c] && valid[d]) {
        // CCW when viewed from above (+Z) -> upward-facing normals.
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  return { positions, indices };
}

/**
 * Bilinear elevation lookup at projected coordinates (x, y) — NOT recentered.
 * Returns null outside the raster or when a contributing sample is NoData.
 */
export function sampleHeightfield(
  input: Omit<TerrainGeometryInput, "offset">,
  x: number,
  y: number
): number | null {
  const { elevations, n, bounds, nodata } = input;
  const [minX, minY, maxX, maxY] = bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;

  // Continuous grid coords relative to pixel centers (row 0 = north).
  const gx = (x - minX) / dx - 0.5;
  const gy = (maxY - y) / dy - 0.5;
  const col0 = Math.floor(gx);
  const row0 = Math.floor(gy);
  const col1 = Math.min(Math.max(col0 + 1, 0), n - 1);
  const row1 = Math.min(Math.max(row0 + 1, 0), n - 1);
  const c0 = Math.min(Math.max(col0, 0), n - 1);
  const r0 = Math.min(Math.max(row0, 0), n - 1);
  if (gx < -0.5 || gy < -0.5 || gx > n - 0.5 || gy > n - 0.5) {
    return null;
  }

  const z00 = elevations[r0 * n + c0];
  const z01 = elevations[r0 * n + col1];
  const z10 = elevations[row1 * n + c0];
  const z11 = elevations[row1 * n + col1];
  for (const z of [z00, z01, z10, z11]) {
    if (isInvalidElevation(z, nodata)) {
      return null;
    }
  }

  const fx = Math.min(Math.max(gx - col0, 0), 1);
  const fy = Math.min(Math.max(gy - row0, 0), 1);
  const top = z00 + (z01 - z00) * fx;
  const bottom = z10 + (z11 - z10) * fx;
  return top + (bottom - top) * fy;
}
