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
  /** lowest VALID elevation (m); NoData vertices are parked at 0 and excluded */
  minElevation: number;
  /** n*n*3 vertex positions in the recentered data frame (Z-up) */
  positions: Float32Array;
}

/** Elevations below this are treated as NoData even without a nodata tag. */
const MIN_PLAUSIBLE_ELEVATION = -1000;

/**
 * Metres each tile's border drops as a vertical "skirt". Terrain vertices sit
 * at pixel CENTERS, so a tile's mesh stops half a pixel short of its bounds;
 * where two tiles of different resolution abut, that leaves a thin strip with
 * no geometry and the bright sky/background shows through (a white seam line).
 * Snapping the border ring to the true edge closes the horizontal gap; the
 * skirt then hides any residual vertical crack from the two tiles sampling the
 * elevation at different resolutions.
 */
const SKIRT_DEPTH = 30;

function isInvalidElevation(z: number, nodata: number | null): boolean {
  return (
    !Number.isFinite(z) ||
    z < MIN_PLAUSIBLE_ELEVATION ||
    (nodata !== null && z === nodata)
  );
}

/**
 * Builds the four-border skirt: a bottom ring dropped SKIRT_DEPTH below each
 * edge vertex, wound so the wall normals face outward. Appends bottom vertices
 * to `skirtVerts` (xyz triples, indexed from `firstIndex`) and the wall
 * triangles to `indices`. North/east edges are wound CCW-from-top, south/west
 * the other way, so all four walls face away from the tile centre.
 */
function appendSkirts(
  grid: Float32Array,
  valid: Uint8Array,
  n: number,
  skirtVerts: number[],
  indices: number[],
  firstIndex: number
): void {
  let s = firstIndex;
  const addBorder = (top: number[], ccwTop: boolean): void => {
    const base = s;
    for (const gi of top) {
      skirtVerts.push(
        grid[gi * 3],
        grid[gi * 3 + 1],
        grid[gi * 3 + 2] - SKIRT_DEPTH
      );
      s++;
    }
    for (let k = 0; k < top.length - 1; k++) {
      const tp = top[k];
      const tq = top[k + 1];
      if (!(valid[tp] && valid[tq])) {
        continue; // don't hang a skirt off a hole
      }
      const bp = base + k;
      const bq = base + k + 1;
      if (ccwTop) {
        indices.push(tp, tq, bq, tp, bq, bp); // north & east edges
      } else {
        indices.push(tp, bq, tq, tp, bp, bq); // south & west edges
      }
    }
  };
  const north: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
  for (let col = 0; col < n; col++) {
    north.push(col);
    south.push((n - 1) * n + col);
  }
  for (let row = 0; row < n; row++) {
    west.push(row * n);
    east.push(row * n + (n - 1));
  }
  addBorder(north, true);
  addBorder(east, true);
  addBorder(south, false);
  addBorder(west, false);
}

/**
 * Fills the n*n vertex grid (pixel centres, recentered) + the valid mask, and
 * returns the lowest VALID elevation. NoData vertices are parked at z=0 and
 * excluded from the min — so the height-fog floor anchors to the real valley,
 * not the phantom z=0 holes.
 */
function fillGrid(
  input: TerrainGeometryInput,
  grid: Float32Array,
  valid: Uint8Array
): number {
  const { elevations, n, bounds, offset, nodata } = input;
  const [minX, minY, maxX, maxY] = bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  let p = 0;
  let minElevation = Number.POSITIVE_INFINITY;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const z = elevations[i];
      const bad = isInvalidElevation(z, nodata);
      valid[i] = bad ? 0 : 1;
      if (!bad && z < minElevation) {
        minElevation = z;
      }
      // Pixel centers; raster row 0 = north (maxY).
      grid[p++] = minX + (col + 0.5) * dx - offset.cx;
      grid[p++] = maxY - (row + 0.5) * dy - offset.cy;
      grid[p++] = bad ? 0 : z;
    }
  }
  return Number.isFinite(minElevation) ? minElevation : 0;
}

export function buildTerrainGeometryData(
  input: TerrainGeometryInput
): TerrainGeometryData {
  const { n, bounds, offset } = input;
  const [minX, minY, maxX, maxY] = bounds;
  if (maxX <= minX || maxY <= minY) {
    throw new Error(`Degenerate terrain bounds: [${bounds.join(", ")}]`);
  }

  const grid = new Float32Array(n * n * 3);
  const valid = new Uint8Array(n * n);
  const minElevation = fillGrid(input, grid, valid);

  // Snap the border ring out to the tile's TRUE edge so neighbouring tiles
  // meet exactly (no half-pixel sky gap). Only the perpendicular axis moves;
  // the stretched half-pixel sliver is invisible.
  const eMinX = minX - offset.cx;
  const eMaxX = maxX - offset.cx;
  const eMinY = minY - offset.cy;
  const eMaxY = maxY - offset.cy;
  for (let col = 0; col < n; col++) {
    grid[(0 * n + col) * 3 + 1] = eMaxY; // north row -> maxY
    grid[((n - 1) * n + col) * 3 + 1] = eMinY; // south row -> minY
  }
  for (let row = 0; row < n; row++) {
    grid[(row * n + 0) * 3] = eMinX; // west col -> minX
    grid[(row * n + (n - 1)) * 3] = eMaxX; // east col -> maxX
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

  // Vertical skirt around the four borders fills any residual crack at tile
  // seams with terrain instead of bright background.
  const skirtVerts: number[] = [];
  appendSkirts(grid, valid, n, skirtVerts, indices, n * n);

  const positions = new Float32Array(grid.length + skirtVerts.length);
  positions.set(grid, 0);
  positions.set(skirtVerts, grid.length);

  return { positions, indices, minElevation };
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
