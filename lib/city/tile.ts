/**
 * The tiles the viewer loads, and the names of the files prepared for them.
 * One home for the tile ids: `scripts/prepare-data.ts` bakes exactly these
 * into `public/data/`, and `app/_components/city-walk-client.tsx` builds its
 * URLs from the same list. No THREE, no DOM.
 *
 * Tile id scheme (Saxony open data):
 * `<UTM zone><easting km>_<northing km>_<edge km>_sn`.
 */

/** Spawn tile — the one that is walked on, collided with and demolished. */
export const PRIMARY_TILE = "33412_5656_2_sn";

/** The rest of the 2x2 block, loaded for context only. */
export const NEIGHBOUR_TILES = [
  "33410_5656_2_sn",
  "33410_5658_2_sn",
  "33412_5658_2_sn",
];

/**
 * Heightfield grid size per role. The primary tile carries the silhouette the
 * player walks over and is sampled for ground height, so it gets 1024² (~2 m
 * over a 2 km tile); the neighbours are backdrop and load at 512².
 */
export const PRIMARY_HEIGHTFIELD_N = 1024;
export const NEIGHBOUR_HEIGHTFIELD_N = 512;

/**
 * Land-cover raster edge (px) served per role. The bakes write 4096² (≈0.5 m
 * per texel over a 2 km tile); the neighbours are backdrop and are
 * downsampled at prepare time to 2048² (≈1 m) — a quarter of the texture
 * memory, which is what keeps a 2×2 block inside a phone's GPU budget.
 */
export const PRIMARY_RASTER_PX = 4096;
export const NEIGHBOUR_RASTER_PX = 2048;

export interface TileSpec {
  /** heightfield grid size baked and served for this tile */
  n: number;
  /** land-cover raster edge served for this tile (px) */
  raster: number;
  tile: string;
}

/** Every tile the app loads, with the grid size it is served at. */
export const TILE_BLOCK: TileSpec[] = [
  { tile: PRIMARY_TILE, n: PRIMARY_HEIGHTFIELD_N, raster: PRIMARY_RASTER_PX },
  ...NEIGHBOUR_TILES.map((tile) => ({
    tile,
    n: NEIGHBOUR_HEIGHTFIELD_N,
    raster: NEIGHBOUR_RASTER_PX,
  })),
];

/** Files served from /data (= public/data/), all derived from the tile id. */
export function cityJsonFile(tile: string): string {
  return `lod2_${tile}.city.json`;
}

/** The baked building mesh (lib/city/city-mesh.ts): vertex stream + meta. */
export function cityMeshDataFile(tile: string): string {
  return `city_${tile}.mesh.bin.gz`;
}

export function cityMeshMetaFile(tile: string): string {
  return `city_${tile}.mesh.json`;
}

/** The committed inputs of the building-mesh bake (CityJSON + DOP roof LUT). */
export function cityMeshSourceFiles(tile: string): {
  city: string;
  roofColor: string;
} {
  return {
    city: `data/cityjson/${cityJsonFile(tile)}`,
    roofColor: `data/dop/roofcolor_${tile}.json`,
  };
}

export function heightfieldHeaderFile(tile: string, n: number): string {
  return `dgm1_${tile}.heightfield-${n}.json`;
}

export function heightfieldDataFile(tile: string, n: number): string {
  return `dgm1_${tile}.heightfield-${n}.u16.gz`;
}

/** Where a committed source lives under data/ (null = baked by prepare-data
 *  from committed sources — the heightfield from the DGM GeoTIFF, the building
 *  mesh from CityJSON + the DOP roof LUT). */
export type ArtifactSource = "dlm" | null;

export interface TileArtifact {
  /** file name under public/data (= the URL's last segment) */
  file: string;
  /** false = the loader treats a 404 as "feature off" */
  required: boolean;
  source: ArtifactSource;
}

export type TileArtifactKind =
  | "bridge"
  | "canopy"
  | "cityMeshData"
  | "cityMeshMeta"
  | "heightfieldData"
  | "heightfieldHeader"
  | "lamps"
  | "landcover"
  | "landcoverRgb"
  | "ndvi"
  | "platform"
  | "rail"
  | "railarea"
  | "vegrows"
  | "walls";

/**
 * Every file the viewer may request for a tile — the ONE list that
 * scripts/prepare-data.ts copies and city-walk-client.tsx requests. Add an
 * artifact here, nowhere else.
 */
export function tileArtifacts(
  spec: TileSpec
): Record<TileArtifactKind, TileArtifact> {
  const { tile, n } = spec;
  const dlm = (file: string, required = false): TileArtifact => ({
    file,
    required,
    source: "dlm",
  });
  return {
    cityMeshMeta: {
      file: cityMeshMetaFile(tile),
      required: true,
      source: null,
    },
    cityMeshData: {
      file: cityMeshDataFile(tile),
      required: true,
      source: null,
    },
    heightfieldHeader: {
      file: heightfieldHeaderFile(tile, n),
      required: true,
      source: null,
    },
    heightfieldData: {
      file: heightfieldDataFile(tile, n),
      required: true,
      source: null,
    },
    landcover: dlm(`landcover_${tile}.png`, true),
    landcoverRgb: dlm(`landcover_rgb_${tile}.png`, true),
    vegrows: dlm(`vegrows_${tile}.geojson`, true),
    canopy: dlm(`canopy_${tile}.geojson`, true),
    ndvi: dlm(`ndvi_${tile}.png`),
    lamps: dlm(`lamps_${tile}.geojson`),
    rail: dlm(`rail_${tile}.geojson`),
    bridge: dlm(`bridge_${tile}.geojson`),
    railarea: dlm(`railarea_${tile}.geojson`),
    platform: dlm(`platform_${tile}.geojson`),
    walls: dlm(`walls_${tile}.geojson`),
  };
}

/** The same map as URLs under `base` (default: the /data route). */
export function tileUrls(
  spec: TileSpec,
  base = "/data"
): Record<TileArtifactKind, string> {
  const out = {} as Record<TileArtifactKind, string>;
  for (const [kind, artifact] of Object.entries(tileArtifacts(spec))) {
    out[kind as TileArtifactKind] = `${base}/${artifact.file}`;
  }
  return out;
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

/** The artifact map as served URLs, resolved through the manifest. */
export function tileUrlsFrom(
  spec: TileSpec,
  manifest: DataManifest | null,
  base = "/data"
): Record<TileArtifactKind, string> {
  const out = {} as Record<TileArtifactKind, string>;
  for (const [kind, artifact] of Object.entries(tileArtifacts(spec))) {
    out[kind as TileArtifactKind] = manifestUrl(manifest, artifact.file, base);
  }
  return out;
}
