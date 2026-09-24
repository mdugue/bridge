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
 * Delatin tolerances (m) of the terrain TINs (lib/city/terrain-tin.ts, baked
 * from the NATIVE 1 m DGM1 by scripts/bake-terrain-tin.ts) — the ground every
 * tile is meshed from. The primary tile is walked on: at 0.15 m its TIN is
 * ~305k triangles (a seventh of the old 1024² grid) in about the grid's
 * bytes, and matches or beats it on every accuracy metric of the terrain
 * study (docs/transformations.md, "Terrain TIN"). The neighbours are backdrop
 * seen from the primary or from the air: at 0.25 m a TIN is 150–240k
 * triangles, a third of their 512² grids (≈4 m spacing, which smears every
 * wall and embankment), for 1.6–2.2× the grid's gzipped bytes (0.5–0.8 MB).
 */
export const PRIMARY_TIN_MAX_ERROR = 0.15;
export const NEIGHBOUR_TIN_MAX_ERROR = 0.25;

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
  /** Delatin tolerance (m) of the terrain TIN baked for this tile, which the
   *  viewer then meshes the ground from; absent = no TIN, the tile is meshed
   *  from its heightfield (+ the client wall conflation, ADR 0014) */
  tinMaxError?: number;
}

/** Every tile the app loads, with the grid size it is served at. */
export const TILE_BLOCK: TileSpec[] = [
  {
    tile: PRIMARY_TILE,
    n: PRIMARY_HEIGHTFIELD_N,
    raster: PRIMARY_RASTER_PX,
    tinMaxError: PRIMARY_TIN_MAX_ERROR,
  },
  ...NEIGHBOUR_TILES.map((tile) => ({
    tile,
    n: NEIGHBOUR_HEIGHTFIELD_N,
    raster: NEIGHBOUR_RASTER_PX,
    tinMaxError: NEIGHBOUR_TIN_MAX_ERROR,
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

/** The terrain TIN (lib/city/terrain-tin.ts), named by its tolerance in cm. */
export function terrainTinHeaderFile(tile: string, maxError: number): string {
  return `dgm1_${tile}.tin-${Math.round(maxError * 100)}cm.json`;
}

export function terrainTinDataFile(tile: string, maxError: number): string {
  return `dgm1_${tile}.tin-${Math.round(maxError * 100)}cm.bin.gz`;
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
  "lowveg",
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
  | "canopyx"
  | "heightfieldData"
  | "landcoverLow"
  | "landcoverRgbLow";

/** The kinds only a tile with a terrain TIN (`TileSpec.tinMaxError`) has. */
export type TinArtifactKind = "terrainTinData" | "terrainTinHeader";

/** A tile's artifact map: every kind, plus the TIN pair when it has one. */
export type TileArtifacts = Record<TileArtifactKind, TileArtifact> &
  Partial<Record<TinArtifactKind, TileArtifact>>;

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
export function tileArtifacts(spec: TileSpec): TileArtifacts {
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
    trees: dlm(`trees_${tile}.geojson`),
    lowveg: dlm(`lowveg_${tile}.geojson`),
    canopyx: dlm(`canopyx_${tile}.geojson`),
    ...tinArtifacts(spec),
  };
}

/** The TIN header + payload, baked from the DGM by prepare-data. Required:
 *  a tile whose spec names a tolerance is meshed from its TIN, never from
 *  the heightfield. */
function tinArtifacts(
  spec: TileSpec
): Partial<Record<TinArtifactKind, TileArtifact>> {
  if (spec.tinMaxError === undefined) {
    return {};
  }
  return {
    terrainTinHeader: {
      file: terrainTinHeaderFile(spec.tile, spec.tinMaxError),
      required: true,
      source: null,
    },
    terrainTinData: {
      file: terrainTinDataFile(spec.tile, spec.tinMaxError),
      required: true,
      source: null,
    },
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
export type TileUrls = Record<TileUrlKind, string> & {
  /** the terrain TIN's header, on tiles that have one (TileSpec.tinMaxError) */
  terrainTin?: string;
  /** the laser-scan crowns outside the canopy mask; only tiles with a
   *  laser scan have them, so a manifest without the file means "none" and
   *  the viewer does not request a URL that can only 404 */
  canopyx?: string;
};

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
  if (artifacts.terrainTinHeader) {
    out.terrainTin = url(artifacts.terrainTinHeader);
  }
  if (!manifest || manifest.files[artifacts.canopyx.file]) {
    out.canopyx = url(artifacts.canopyx);
  }
  return out;
}
