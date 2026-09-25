/**
 * The per-tile files the viewer loads next to a tile's glTF content (the
 * rasters and feature collections the terrain is dressed with), and where
 * their committed sources live. The tile list is the site's
 * (lib/city/site.ts); the glTF content and the tileset that references all
 * of it are baked by scripts/prepare-data.ts (lib/city/tileset.ts). No
 * THREE, no DOM.
 */
import { type Site, tileIdOf } from "./site";

/** The edge phones get for EVERY tile, and the coarse terrain everywhere:
 *  the colour splat painted from a 4096² class raster is 85 MB of GPU memory
 *  with its mip chain, four times what a phone should spend on the ground
 *  colour of one tile. */
export const MOBILE_RASTER_PX = 2048;

/** The site's tile ids, the spawn tile first. */
export function tileIds(site: Site): string[] {
  return site.tiles.map((cell) => tileIdOf(site, cell));
}

/** The committed CityJSON (data/cityjson/): a bake input, never served. */
export function cityJsonFile(tile: string): string {
  return `lod2_${tile}.city.json`;
}

/** The committed inputs of the building bake (CityJSON + DOP roof LUT). */
export function cityMeshSourceFiles(tile: string): {
  city: string;
  roofColor: string;
} {
  return {
    city: `data/cityjson/${cityJsonFile(tile)}`,
    roofColor: `data/dop/roofcolor_${tile}.json`,
  };
}

export interface TileArtifact {
  /** for a downsampled raster: the committed full-size file it is baked
   *  from (under data/dlm/) and its edge (px) */
  bakedFrom?: { file: string; raster: number };
  /** file name under public/data (before content hashing) */
  file: string;
  /** false = the loader treats a missing file as "feature off" */
  required: boolean;
}

export type TileArtifactKind =
  | "bridge"
  | "canopy"
  | "lamps"
  | "landcover"
  | "landcoverLow"
  | "ndvi"
  | "platform"
  | "rail"
  | "railarea"
  | "surface"
  | "vegrows";

/**
 * Every side file of a tile — the ONE list scripts/prepare-data.ts publishes
 * and names in the tile's glTF extras. Committed under data/dlm/, except the
 * `landcoverLow` class raster, which prepare-data downsamples (NEAREST) from
 * the committed 4096² one.
 */
export function tileArtifacts(
  tile: string
): Record<TileArtifactKind, TileArtifact> {
  const dlm = (file: string, required = false): TileArtifact => ({
    file,
    required,
  });
  return {
    landcover: dlm(`landcover_${tile}.png`, true),
    landcoverLow: {
      file: `landcover_${tile}.r${MOBILE_RASTER_PX}.png`,
      required: true,
      bakedFrom: { file: `landcover_${tile}.png`, raster: MOBILE_RASTER_PX },
    },
    vegrows: dlm(`vegrows_${tile}.geojson`, true),
    // Optional: the canopy bake skips a tile without DOM1 (rows still plant).
    canopy: dlm(`canopy_${tile}.geojson`),
    ndvi: dlm(`ndvi_${tile}.png`),
    // Optional: the OSM paving raster (pipeline/bake/surface.py); without
    // it the ground draws the land-cover class's default pattern.
    surface: dlm(`surface_${tile}.png`),
    lamps: dlm(`lamps_${tile}.geojson`),
    rail: dlm(`rail_${tile}.geojson`),
    bridge: dlm(`bridge_${tile}.geojson`),
    railarea: dlm(`railarea_${tile}.geojson`),
    platform: dlm(`platform_${tile}.geojson`),
  };
}

/** The committed OSM walls (pipeline/bake/walls.py): a terrain bake input
 *  under data/dlm/ — burned into the ground as breaklines, and stood as
 *  ribbons in the fine terrain glTF — never served. */
export function wallSourceFile(tile: string): string {
  return `data/dlm/walls_${tile}.geojson`;
}

/** The committed stairs (pipeline/bake/stairs.py): a terrain bake input
 *  under data/dlm/ — the fine terrain glTF carries them — never served. */
export function stairSourceFile(tile: string): string {
  return `data/dlm/stairs_${tile}.geojson`;
}

/** The committed terraces (raised OSM areas, pipeline/bake/stairs.py): a
 *  terrain bake input under data/dlm/, never served. */
export function terraceSourceFile(tile: string): string {
  return `data/dlm/terraces_${tile}.geojson`;
}

/** The committed DGM GeoTIFF (+ its .tfw sidecar) the heightfield bake reads. */
export function dgmSourceFiles(tile: string): { tif: string; tfw: string } {
  const dir = `data/dgm/dgm1_${tile}_tiff`;
  return { tif: `${dir}/dgm1_${tile}.tif`, tfw: `${dir}/dgm1_${tile}.tfw` };
}

/**
 * `public/data/manifest.json`, written by scripts/prepare-data.ts: maps each
 * artifact's logical file name (the names above) to the content-hashed name
 * it is actually served under. Hashed names let `/data/*` be cached as
 * immutable (see next.config.ts) while a re-bake still reaches every client
 * through the manifest, which is the one file served with `no-cache`.
 */
export const MANIFEST_FILE = "manifest.json";

export interface DataManifest {
  files: Record<string, string>;
  version: 1;
}

/** Resolves a logical artifact name through the manifest (unknown → as is). */
export function manifestUrl(
  manifest: DataManifest | null,
  file: string,
  base = "/data"
): string {
  return `${base}/${manifest?.files[file] ?? file}`;
}
