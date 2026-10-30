/**
 * The ground plate: the whole site's ground at a coarse grid, there from
 * the start, under every tile that has no terrain level on screen yet —
 * the "Bodenplatte" (docs/plans/076-streaming-without-holes.md). A tile's
 * own terrain takes over where it lands; the plate only ever fills what
 * is not there, so a flight or a turn never shows a hole to the sky.
 *
 * The bake (scripts/prepare-data.ts) writes one small file for the site:
 * per tile, in the tileset extras' order, `PLATE_N`² heights on a vertex
 * grid that includes the tile's edges (neighbours share their edge rows,
 * so the plate has no seams) and the land-cover class at each vertex. The
 * colours are the palette's (lib/city/landcover.ts), at runtime: a colour
 * change is not a re-bake. No THREE, no DOM.
 *
 * Layout, little-endian: per tile `PLATE_N`² int16 heights (decimetres),
 * then per tile `PLATE_N`² uint8 classes. Rows run north to south, columns
 * west to east (the coarse grid's convention).
 */
import type { TerrainBounds } from "./terrain-geometry";

/** Vertices along a tile's edge: 62.5 m apart on a 2 km tile. */
export const PLATE_N = 33;

/** The tileset extras' entry for the site's plate, `extras.plate` (beside
 *  `TilesetExtras`, not in it: lib/city/tileset.ts keys every terrain
 *  bake's cache, and the plate is not one of them). */
export interface PlateRef {
  /** each tile's id and extent, in the file's order (the site's every
   *  tile; the viewer draws those its tileset streams) */
  tiles: { id: string; bounds: TerrainBounds }[];
  /** the published file, relative to the tileset */
  file: string;
  /** vertices along a tile's edge */
  n: number;
}

export interface PlateExtras {
  /** absent in a tileset baked before the plate */
  plate?: PlateRef;
}

/** The plate a tileset's extras name, if they name a well-formed one. */
export function plateOf(extras: unknown): PlateRef | undefined {
  const plate = (extras as PlateExtras | null)?.plate;
  return plate &&
    typeof plate.file === "string" &&
    typeof plate.n === "number" &&
    Array.isArray(plate.tiles)
    ? plate
    : undefined;
}

export interface PlateTile {
  id: string;
  bounds: TerrainBounds;
  /** classes, `n`² row-major from the north-west corner */
  classes: Uint8Array;
  /** heights (m), `n`² row-major from the north-west corner */
  heights: Float32Array;
}

/** The vertex grid's coordinates over `bounds`: column `i` (west → east),
 *  row `j` (north → south). */
export function plateVertex(
  bounds: TerrainBounds,
  n: number,
  i: number,
  j: number
): [number, number] {
  const [x0, y0, x1, y1] = bounds;
  return [x0 + (i / (n - 1)) * (x1 - x0), y1 - (j / (n - 1)) * (y1 - y0)];
}

/**
 * A tile's plate heights (dm) from the ground's height function; a vertex
 * with no ground (a DGM hole, past the data's edge) takes `fallback`.
 */
export function plateHeights(
  bounds: TerrainBounds,
  heightAt: (x: number, y: number) => number | null,
  fallback: number,
  n = PLATE_N
): Int16Array {
  const out = new Int16Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [x, y] = plateVertex(bounds, n, i, j);
      out[j * n + i] = Math.round((heightAt(x, y) ?? fallback) * 10);
    }
  }
  return out;
}

/** A class raster and the extent it covers (row 0 = north). */
export interface ClassRaster {
  bounds: TerrainBounds;
  data: Uint8Array;
  height: number;
  width: number;
}

/**
 * A tile's plate classes, each vertex the commonest class within half a
 * cell around it — the nearest texel alone made a road look like the
 * plate's every third vertex. The window reads every raster it reaches
 * (`rasters`: the tile's own and its neighbours'), so a vertex on a shared
 * edge gets the same class in both tiles: the plate has no colour seam.
 */
export function plateClasses(
  bounds: TerrainBounds,
  rasters: readonly ClassRaster[],
  n = PLATE_N
): Uint8Array {
  const out = new Uint8Array(n * n);
  const counts = new Uint32Array(256);
  const half = (bounds[2] - bounds[0]) / (n - 1) / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [x, y] = plateVertex(bounds, n, i, j);
      counts.fill(0);
      let best = 0;
      let bestCount = 0;
      for (const r of rasters) {
        const [best1, count1] = countWindow(
          r,
          [x - half, y - half, x + half, y + half],
          counts,
          best,
          bestCount
        );
        best = best1;
        bestCount = count1;
      }
      out[j * n + i] = best;
    }
  }
  return out;
}

/** Adds a raster's texels inside `win` (EPSG) to `counts`; the running
 *  commonest class and its count. */
function countWindow(
  r: ClassRaster,
  win: TerrainBounds,
  counts: Uint32Array,
  best: number,
  bestCount: number
): [number, number] {
  const [x0, y0, x1, y1] = r.bounds;
  const sx = r.width / (x1 - x0);
  const sy = r.height / (y1 - y0);
  // texel centres inside the window, clipped to the raster
  const ia = Math.max(0, Math.ceil((win[0] - x0) * sx - 0.5));
  const ib = Math.min(r.width - 1, Math.floor((win[2] - x0) * sx - 0.5));
  const ja = Math.max(0, Math.ceil((y1 - win[3]) * sy - 0.5));
  const jb = Math.min(r.height - 1, Math.floor((y1 - win[1]) * sy - 0.5));
  for (let y = ja; y <= jb; y++) {
    for (let x = ia; x <= ib; x++) {
      const c = r.data[y * r.width + x];
      const k = ++counts[c];
      if (k > bestCount) {
        bestCount = k;
        best = c;
      }
    }
  }
  return [best, bestCount];
}

/** A class raster cut down by an integer factor, nearest texel (no class
 *  ids blend): the bake keeps the site's rasters this small. */
export function shrinkClassRaster(r: ClassRaster, factor: number): ClassRaster {
  const width = Math.floor(r.width / factor);
  const height = Math.floor(r.height / factor);
  const data = new Uint8Array(width * height);
  const o = Math.floor(factor / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = r.data[(y * factor + o) * r.width + x * factor + o];
    }
  }
  return { bounds: r.bounds, data, height, width };
}

/** The site's plate file from each tile's heights (dm) and classes. */
export function encodePlate(
  tiles: { classes: Uint8Array; heights: Int16Array }[],
  n = PLATE_N
): Uint8Array {
  const per = n * n;
  const out = new Uint8Array(tiles.length * per * 3);
  const view = new DataView(out.buffer);
  tiles.forEach((t, k) => {
    if (t.heights.length !== per || t.classes.length !== per) {
      throw new Error(`plate: tile ${k} is not ${n}²`);
    }
    for (let v = 0; v < per; v++) {
      view.setInt16((k * per + v) * 2, t.heights[v], true);
    }
    out.set(t.classes, tiles.length * per * 2 + k * per);
  });
  return out;
}

/** The plate file read back: one entry per tile of `bounds`, in order. */
export function decodePlate(
  bytes: Uint8Array,
  tiles: PlateRef["tiles"],
  n: number
): PlateTile[] {
  const per = n * n;
  if (bytes.length !== tiles.length * per * 3) {
    throw new Error(
      `plate: ${bytes.length} bytes for ${tiles.length} tiles of ${n}²`
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return tiles.map(({ id, bounds }, k) => {
    const heights = new Float32Array(per);
    for (let v = 0; v < per; v++) {
      heights[v] = view.getInt16((k * per + v) * 2, true) / 10;
    }
    const at = tiles.length * per * 2 + k * per;
    return { id, bounds, classes: bytes.slice(at, at + per), heights };
  });
}

/** The grid's triangles (two per cell), shared by every tile's mesh. */
export function plateIndex(n: number): Uint16Array {
  const out = new Uint16Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // counter-clockwise seen from above in the Y-up scene frame (north is
      // −z there): a (NW) → c (SW) → b (NE), b → c → d (SE)
      out.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  return out;
}

/** How a tile's plate sits under its terrain: the plate's vertices span
 *  62.5 m and cut across hollows the real ground dips into, so its inner
 *  vertices are drawn this far (m) below their heights — only ever where
 *  nothing else is. The edge rows keep theirs, so a plated tile meets a
 *  landed neighbour's ground without a step (the inks would draw one). */
export const PLATE_SINK_M = 1.5;

/** A tile's plate as Y-up scene-frame positions (`x = X − cx`, `y = h`,
 *  `z = −(Y − cy)`, AGENTS.md "Coordinate system"). */
export function platePositions(
  tile: PlateTile,
  n: number,
  offset: { cx: number; cy: number }
): Float32Array {
  const out = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const [x, y] = plateVertex(tile.bounds, n, i, j);
      out[v * 3] = x - offset.cx;
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      out[v * 3 + 1] = tile.heights[v] - (edge ? 0 : PLATE_SINK_M);
      out[v * 3 + 2] = -(y - offset.cy);
    }
  }
  return out;
}

/**
 * The plate's normals in the Y-up frame from central differences over the
 * whole site's heights (`heightAt`, EPSG), so an edge vertex shades the
 * same in both tiles; one-sided at the site's edge.
 */
export function plateNormals(
  tile: PlateTile,
  n: number,
  heightAt: (x: number, y: number) => number | undefined
): Float32Array {
  const out = new Float32Array(n * n * 3);
  const step = (tile.bounds[2] - tile.bounds[0]) / (n - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const [x, y] = plateVertex(tile.bounds, n, i, j);
      const h = tile.heights[v];
      const dx = slope(heightAt(x + step, y), heightAt(x - step, y), h, step);
      const dy = slope(heightAt(x, y + step), heightAt(x, y - step), h, step);
      // scene z = −Y: the normal is (−∂h/∂x, 1, ∂h/∂Y)
      const len = Math.hypot(dx, 1, dy);
      out[v * 3] = -dx / len;
      out[v * 3 + 1] = 1 / len;
      out[v * 3 + 2] = dy / len;
    }
  }
  return out;
}

/** The ground's slope at a vertex from its neighbours ahead and behind,
 *  one-sided where one is missing (the site's edge). */
function slope(
  ahead: number | undefined,
  behind: number | undefined,
  h: number,
  step: number
): number {
  const span =
    (ahead === undefined ? 0 : step) + (behind === undefined ? 0 : step);
  return span === 0 ? 0 : ((ahead ?? h) - (behind ?? h)) / span;
}

/** Every plate vertex's height by its EPSG position, across the tiles. */
export function plateHeightIndex(
  tiles: readonly PlateTile[],
  n: number
): (x: number, y: number) => number | undefined {
  const at = new Map<string, number>();
  for (const t of tiles) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [x, y] = plateVertex(t.bounds, n, i, j);
        at.set(
          `${Math.round(x * 10)},${Math.round(y * 10)}`,
          t.heights[j * n + i]
        );
      }
    }
  }
  return (x, y) => at.get(`${Math.round(x * 10)},${Math.round(y * 10)}`);
}

/**
 * The plate's heights as a ground (EPSG → m a.s.l., null off every
 * tile), bilinear over each tile's vertex grid as drawn (`positions`, the
 * Y-up frame of `platePositions`): where a tile's terrain has not landed
 * yet, a vantage still knows the hill it stands on. It reads the meshes'
 * own arrays, keeping nothing of its own.
 */
export function plateGround(
  tiles: readonly { bounds: TerrainBounds; positions: ArrayLike<number> }[],
  n: number
): (x: number, y: number) => number | null {
  const heightOf = (positions: ArrayLike<number>, i: number, j: number) => {
    const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
    return positions[(j * n + i) * 3 + 1] + (edge ? 0 : PLATE_SINK_M);
  };
  // the tiles are one grid: a point finds its tile by its cell, not by
  // asking every tile (the framing asks thousands of times)
  const [first] = tiles;
  const w = first ? first.bounds[2] - first.bounds[0] : 1;
  const h = first ? first.bounds[3] - first.bounds[1] : 1;
  const cell = (x: number, y: number) =>
    `${Math.floor(x / w)},${Math.floor(y / h)}`;
  const byCell = new Map(
    tiles.map((t) => [
      cell((t.bounds[0] + t.bounds[2]) / 2, (t.bounds[1] + t.bounds[3]) / 2),
      t,
    ])
  );
  const holds = (b: TerrainBounds, x: number, y: number) =>
    x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  return (x, y) => {
    const near = byCell.get(cell(x, y));
    // on a cell's north or east edge the cell beyond may hold nothing
    const tile =
      near && holds(near.bounds, x, y)
        ? near
        : tiles.find((t) => holds(t.bounds, x, y));
    if (tile) {
      const { bounds, positions } = tile;
      const [x0, y0, x1, y1] = bounds;
      // column from the west, row from the north
      const u = ((x - x0) / (x1 - x0)) * (n - 1);
      const v = ((y1 - y) / (y1 - y0)) * (n - 1);
      const i = Math.min(Math.floor(u), n - 2);
      const j = Math.min(Math.floor(v), n - 2);
      const fu = u - i;
      const fv = v - j;
      const top =
        heightOf(positions, i, j) * (1 - fu) +
        heightOf(positions, i + 1, j) * fu;
      const bottom =
        heightOf(positions, i, j + 1) * (1 - fu) +
        heightOf(positions, i + 1, j + 1) * fu;
      return top * (1 - fv) + bottom * fv;
    }
    return null;
  };
}
