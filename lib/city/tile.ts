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
 * Land-cover raster edge (px) baked per role. The DLM bake writes 4096²
 * (≈0.5 m per texel over a 2 km tile); the neighbours are backdrop and are
 * downsampled at prepare time to 2048² (≈1 m) — a quarter of the texture
 * memory, which is what keeps a 2×2 block inside a phone's GPU budget. What a
 * device is actually served is tier-dependent: see MOBILE_RASTER_PX.
 */
export const PRIMARY_RASTER_PX = 4096;
export const NEIGHBOUR_RASTER_PX = 2048;
/** The edge the DLM bake writes (the committed source rasters). */
export const BAKED_RASTER_PX = 4096;
/** The edge phones get for EVERY tile, the primary included: a 4096² RGBA
 *  splat is 85 MB of GPU memory with its mip chain, four times what a phone
 *  should spend on the ground colour of one tile. */
export const MOBILE_RASTER_PX = 2048;

export interface TileSpec {
  /** heightfield grid size baked and served for this tile */
  n: number;
  /** land-cover raster edge baked for this tile (px); desktops are served
   *  it as is, phones take min(raster, MOBILE_RASTER_PX) */
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

// File names under /data (= public/data/) and their bake inputs, all derived
// from the tile id.

/** The committed CityJSON (data/cityjson/): a bake input, never served. */
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

/** How prepare-data resamples a raster: NEAREST keeps class ids exact
 *  (none may blend), Lanczos filters colour. */
export type RasterResample = "lanczos3" | "nearest";

export interface TileArtifact {
  /** for a downsampled raster: the committed full-size file it is baked from,
   *  and where under data/ that file lives */
  bakedFrom?: { file: string; source: Exclude<ArtifactSource, null> };
  /** file name under public/data (= the URL's last segment) */
  file: string;
  /** for a downsampled raster: its edge (px) */
  raster?: number;
  /** false = the loader treats a 404 as "feature off" */
  required: boolean;
  /** for a downsampled raster: the kernel (see RasterResample) */
  resample?: RasterResample;
  source: ArtifactSource;
}

/**
 * The kinds the viewer requests (see `tileUrlsFrom`). The `…Low` rasters
 * are not kinds of their own on this side — `landcover` / `landcoverRgb`
 * resolve to the device's variant — and the heightfield data is reached
 * through its header, which names the published sibling
 * (lib/city/heightfield.ts).
 */
export const TILE_URL_KINDS = [
  "bridge",
  "canopy",
  "cityMeshData",
  "cityMeshMeta",
  "heightfieldHeader",
  "lamps",
  "landcover",
  "landcoverRgb",
  "ndvi",
  "platform",
  "rail",
  "railarea",
  "trees",
  "vegrows",
  "walls",
] as const;

export type TileUrlKind = (typeof TILE_URL_KINDS)[number];

/** Every artifact prepare-data publishes: the served kinds plus the bake-only ones. */
export type TileArtifactKind =
  | TileUrlKind
  | "heightfieldData"
  | "landcoverLow"
  | "landcoverRgbLow";

/**
 * A land-cover raster at `px`: the committed 4096² bake as is, or a variant
 * prepare-data downsamples from it (`.r<px>.png`), class ids NEAREST so none
 * blend, the pastel RGB splat Lanczos.
 */
function landcoverArtifact(
  tile: string,
  px: number,
  rgb: boolean
): TileArtifact {
  const base = rgb ? `landcover_rgb_${tile}` : `landcover_${tile}`;
  if (px >= BAKED_RASTER_PX) {
    return { file: `${base}.png`, required: true, source: "dlm" };
  }
  return {
    file: `${base}.r${px}.png`,
    required: true,
    source: null,
    bakedFrom: { file: `${base}.png`, source: "dlm" },
    raster: px,
    resample: rgb ? "lanczos3" : "nearest",
  };
}

/**
 * Every file the viewer may request for a tile — the ONE list that
 * scripts/prepare-data.ts copies and city-walk-client.tsx requests. Add an
 * artifact here, nowhere else. The `…Low` rasters are what phones load (see
 * MOBILE_RASTER_PX); for a tile already served at that size they are the same
 * file.
 */
export function tileArtifacts(
  spec: TileSpec
): Record<TileArtifactKind, TileArtifact> {
  const { tile, n } = spec;
  const low = Math.min(spec.raster, MOBILE_RASTER_PX);
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
    landcover: landcoverArtifact(tile, spec.raster, false),
    landcoverRgb: landcoverArtifact(tile, spec.raster, true),
    landcoverLow: landcoverArtifact(tile, low, false),
    landcoverRgbLow: landcoverArtifact(tile, low, true),
    vegrows: dlm(`vegrows_${tile}.geojson`, true),
    canopy: dlm(`canopy_${tile}.geojson`, true),
    ndvi: dlm(`ndvi_${tile}.png`),
    lamps: dlm(`lamps_${tile}.geojson`),
    rail: dlm(`rail_${tile}.geojson`),
    bridge: dlm(`bridge_${tile}.geojson`),
    railarea: dlm(`railarea_${tile}.geojson`),
    platform: dlm(`platform_${tile}.geojson`),
    walls: dlm(`walls_${tile}.geojson`),
    // Only requested with ?trees=kataster (scene-profile.ts TreeSource).
    trees: dlm(`trees_${tile}.geojson`),
  };
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

/**
 * Every URL the viewer may request for one tile — what create-app.ts loads
 * from. The optional artifacts are URLs too; their loaders treat a 404 as
 * "feature off".
 */
export type TileUrls = Record<TileUrlKind, string>;

/**
 * The artifact map as served URLs, resolved through the manifest.
 * `lowRasters` serves the 2048² land-cover variants (phones, see
 * MOBILE_RASTER_PX); everything else is the same data for every device.
 */
export function tileUrlsFrom(
  spec: TileSpec,
  manifest: DataManifest | null,
  lowRasters: boolean,
  base = "/data"
): TileUrls {
  const artifacts = tileArtifacts(spec);
  const url = (artifact: TileArtifact) =>
    manifestUrl(manifest, artifact.file, base);
  const out = {} as TileUrls;
  for (const kind of TILE_URL_KINDS) {
    out[kind] = url(artifacts[kind]);
  }
  if (lowRasters) {
    out.landcover = url(artifacts.landcoverLow);
    out.landcoverRgb = url(artifacts.landcoverRgbLow);
  }
  return out;
}
