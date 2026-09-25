/**
 * The OGC 3D Tiles tileset the viewer streams (3DTilesRendererJS), and the
 * `extras` the bake writes next to each glTF so the runtime can dress it.
 * scripts/prepare-data.ts writes it; app/_components/tile-stream.ts reads
 * it. No THREE, no DOM.
 *
 * Tree, per site tile:
 *
 *   tile           content: buildings            refine ADD   (always, once visible)
 *     └ terrain L1 content: 512² terrain         refine REPLACE
 *         └ terrain L0 content: TIN terrain + the tile's dressing
 *
 * The buildings of a tile load whenever the tile is in view; the terrain
 * refines from the coarse level to the fine one by screen-space error, and
 * only the fine level carries vegetation, lamps, monuments, street
 * furniture, rails, walls
 * and stairs. Which tile gets the fine level is a question of distance, not
 * of a "primary" role.
 *
 * The tileset's frame is the site's recentered data frame (Z-up, like every
 * 3D Tiles frame); the glTF content is Y-up as glTF requires, and the
 * renderer rotates it in. The tileset's group sits in the viewer's rotated
 * `world` group like every other data-frame layer.
 */
import type { TerrainBounds } from "./terrain-geometry";

/**
 * Whether a tile owns the point: west and south edges in, east and north
 * edges out, so a point on a seam belongs to exactly one tile. Features a bake
 * reads with a margin (lamps near the edge) are dressed by their owner only.
 */
export function ownsPoint(
  bounds: TerrainBounds,
  x: number,
  y: number
): boolean {
  const [minX, minY, maxX, maxY] = bounds;
  return x >= minX && x < maxX && y >= minY && y < maxY;
}

/** Logical names; published under content-hashed names via the manifest. */
export const TILESET_FILE = "tileset.json";
/** The spawn tile alone — the `lite` scene profile (headless tests). */
export const TILESET_SPAWN_FILE = "tileset-spawn.json";

export interface TerrainLevel {
  /** heightfield grid edge */
  n: number;
  /** land-cover raster edge the level samples on desktops (phones: ≤ 2048) */
  raster: number;
}

/** Fine (0) and coarse (1) terrain. The fine level is a TIN over the native
 *  DGM (`TerrainExtras.tin`); its `n` is the grid it falls back to when the
 *  DGM has holes. */
export const TERRAIN_LEVELS: Record<0 | 1, TerrainLevel> = {
  0: { n: 1024, raster: 4096 },
  1: { n: 512, raster: 2048 },
};

/**
 * Geometric error (m) of the coarse terrain: the fine level replaces it once
 * `error · screenHeight / (distance · 2 tan(fov/2))` exceeds the renderer's
 * error target (16 px). 40 m switches at ≈1.2 km from the tile on a 1080p
 * screen at the 55° default field of view. Start value — tune on a GPU.
 */
export const COARSE_TERRAIN_ERROR = 40;
/** Large enough that a visible tile always refines to its terrain. */
const TILE_ERROR = 100_000;

/** The rasters and features a fine terrain tile is dressed with (file names). */
export interface DressingFiles {
  bridge: string;
  canopy: string;
  /** laser-scan crowns outside the canopy mask (tiles with a laser scan) */
  canopyx?: string;
  furniture: string;
  lamps: string;
  /** OSM hedges */
  lowveg?: string;
  monuments: string;
  platform: string;
  rail: string;
  railarea: string;
  /** the street-tree cadastre */
  trees?: string;
  vegrows: string;
}

export interface TerrainExtras {
  bounds: TerrainBounds;
  /** fine level only */
  dressing?: DressingFiles;
  kind: "terrain";
  /** class raster at the level's edge */
  landcover: string;
  /** class raster at ≤ 2048² (phones) */
  landcoverLow: string;
  level: 0 | 1;
  /** lowest valid elevation (m) — the valley floor */
  minElevation: number;
  /** grid edge; unless `tin` is set, the first n·n vertices are the grid,
   *  row 0 = north */
  n: number;
  /**
   * Set when the mesh is an error-bounded TIN (the fine level, baked from
   * the native DGM — scripts/bake-terrain-tin.ts): `triangles` surface
   * triangles refined to `maxError` (m), in cache order with the vertical
   * skirt mixed in. The runtime indexes them for ground height
   * (lib/city/terrain-tin.ts TinIndex) instead of reading a grid.
   */
  tin?: { maxError: number; triangles: number };
  ndvi?: string;
  /** OSM paving raster (fine level only: its patterns are close-range) */
  surface?: string;
  /** edge-distance raster (fine level only) */
  edges?: string;
  /** sports-ground index raster and its table of grounds (both levels) */
  sport?: string;
  sportTable?: string;
  /** road-marking raster and its table (fine level only) */
  markings?: string;
  markingsTable?: string;
  /** sky-view factor raster (both levels; the clay reads it too) */
  svf?: string;
  /** far-horizon raster, four RGBA layers stacked (both levels) */
  horizon?: string;
  /** the site tile (not `tile`: the renderer writes its own `userData.tile`) */
  tileId: string;
}

export interface CityExtras {
  kind: "city";
  /** the tile's sky-view raster, shared with its terrain (the facades'
   *  ambient light) */
  svf?: string;
  tileId: string;
}

export type ContentExtras = CityExtras | TerrainExtras;

export interface TilesetTileInfo {
  bounds: TerrainBounds;
  /**
   * minimap footprints per object: `[object][polygon][vertex] = [x, y]`.
   * Here rather than in the city content, so the minimap shows every
   * building from the start, whatever has streamed in.
   */
  footprints: string;
  id: string;
  /** a ≤ 2048² class raster for the minimap */
  minimap: string;
}

/** What the viewer needs before any content has loaded. */
export interface TilesetExtras {
  epsg: number;
  /** recenter offset: data-frame x = epsgX − cx, y = epsgY − cy */
  offset: { cx: number; cy: number };
  site: string;
  /** the site's tiles, the spawn tile first */
  tiles: TilesetTileInfo[];
}

/** Everything the bake knows about one tile when it writes the tree. */
export interface BakedTile {
  bounds: TerrainBounds;
  city: string;
  id: string;
  /** terrain glb per level */
  terrain: Record<0 | 1, string>;
  /** [min, max] elevation of everything on the tile (terrain + roofs) */
  zRange: [number, number];
}

type Box = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** A 3D Tiles bounding box around a tile's extent, in the recentered frame. */
export function tileBox(
  bounds: TerrainBounds,
  zRange: [number, number],
  offset: { cx: number; cy: number }
): Box {
  const [minX, minY, maxX, maxY] = bounds;
  const hx = (maxX - minX) / 2;
  const hy = (maxY - minY) / 2;
  const hz = Math.max((zRange[1] - zRange[0]) / 2, 1);
  return [
    minX + hx - offset.cx,
    minY + hy - offset.cy,
    (zRange[0] + zRange[1]) / 2,
    hx,
    0,
    0,
    0,
    hy,
    0,
    0,
    0,
    hz,
  ];
}

function tileNode(tile: BakedTile, offset: { cx: number; cy: number }) {
  const boundingVolume = { box: tileBox(tile.bounds, tile.zRange, offset) };
  return {
    boundingVolume,
    geometricError: TILE_ERROR,
    refine: "ADD",
    content: { uri: tile.city },
    children: [
      {
        boundingVolume,
        geometricError: COARSE_TERRAIN_ERROR,
        refine: "REPLACE",
        content: { uri: tile.terrain[1] },
        children: [
          {
            boundingVolume,
            geometricError: 0,
            content: { uri: tile.terrain[0] },
          },
        ],
      },
    ],
  };
}

/** The tileset JSON over `tiles` (the spawn tile first). */
export function buildTileset(
  tiles: BakedTile[],
  extras: TilesetExtras
): object {
  const zRange: [number, number] = [
    Math.min(...tiles.map((t) => t.zRange[0])),
    Math.max(...tiles.map((t) => t.zRange[1])),
  ];
  const bounds: TerrainBounds = [
    Math.min(...tiles.map((t) => t.bounds[0])),
    Math.min(...tiles.map((t) => t.bounds[1])),
    Math.max(...tiles.map((t) => t.bounds[2])),
    Math.max(...tiles.map((t) => t.bounds[3])),
  ];
  return {
    asset: { version: "1.1" },
    geometricError: TILE_ERROR,
    extras,
    root: {
      boundingVolume: { box: tileBox(bounds, zRange, extras.offset) },
      geometricError: TILE_ERROR,
      refine: "ADD",
      children: tiles.map((t) => tileNode(t, extras.offset)),
    },
  };
}

/** Validates the parts of the tileset extras the viewer depends on. */
export function parseTilesetExtras(json: unknown): TilesetExtras {
  const extras = (json as { extras?: Partial<TilesetExtras> } | null)?.extras;
  const ok =
    typeof extras?.epsg === "number" &&
    typeof extras.offset?.cx === "number" &&
    typeof extras.offset.cy === "number" &&
    Array.isArray(extras.tiles) &&
    extras.tiles.length > 0;
  if (!ok) {
    throw new Error("tileset: extras must carry epsg, offset and tiles");
  }
  return extras as TilesetExtras;
}
