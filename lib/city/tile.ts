/**
 * The per-tile files the viewer loads next to a tile's glTF content (the
 * rasters and feature collections the terrain is dressed with), and where
 * their committed sources live. The tile list is the site's
 * (lib/city/site.ts); the glTF content and the tileset that references all
 * of it are baked by scripts/prepare-data.ts (lib/city/tileset.ts). No
 * THREE, no DOM.
 */
import { type Site, tileIdOf } from "./site";

/**
 * A site's committed (or fetched) data: `data/<site>/` with `dgm/`,
 * `cityjson/` (the build's sources), `dlm/`, `dop/` (the bakes' outputs)
 * and `provenance.json`. Paths are relative to the repo root.
 */
export function siteDataDir(site: Site): string {
  return `data/${site.id}`;
}

/**
 * The provider's raw downloads, `data/_raw/<provider>/`, shared by all of
 * its sites (gitignored, never committed): `dom1/`, `dop/` per tile, `dlm/`,
 * `osm/`, and the download cache `downloads/`.
 */
export function providerRawDir(site: Site): string {
  return `data/_raw/${site.provider.id}`;
}

/** The edge phones get for EVERY tile, and the coarse terrain everywhere:
 *  the colour splat painted from a 4096² class raster is 85 MB of GPU memory
 *  with its mip chain, four times what a phone should spend on the ground
 *  colour of one tile. */
export const MOBILE_RASTER_PX = 2048;

/**
 * The coarse terrain's edge, on every tier: a 40 m-error mesh shown from
 * ≈ 2.1 km on a phone and ≈ 2.6 km on a desktop — where the fog ends —
 * whose 2 m texels are about a pixel out there. At 2048² its class raster
 * and painted splat held 25 MiB per tile, and most tiles in view are
 * coarse-only.
 */
export const COARSE_RASTER_PX = 1024;

/** The site's tile ids, the spawn tile first. */
export function tileIds(site: Site): string[] {
  return site.tiles.map((cell) => tileIdOf(site, cell));
}

/** The site's CityJSON (data/<site>/cityjson/): a build input, never served. */
export function cityJsonFile(tile: string): string {
  return `lod2_${tile}.city.json`;
}

/** The inputs of the building bake (CityJSON + DOP roof LUT + the OSM
 *  facts per object + the laser scan's small structures + the structures
 *  the surface model shows beyond LoD2 + the landmarks Wikidata knows +
 *  the roofs rebuilt from DOM1 + OSM's entrances on the walls + the
 *  dormers DOM1 shows on the pitched roofs + the shopfronts street photos
 *  show on the ground floors, with the canopies DOM1 shows over them +
 *  the facade traits they measure on the upper walls, the windows). */
export function cityMeshSourceFiles(
  site: Site,
  tile: string
): {
  city: string;
  doors: string;
  dormers: string;
  measuredRoofs: string;
  osmBuild: string;
  plinths: string;
  roofColor: string;
  landmarks: string;
  shopfronts: string;
  smallBuild: string;
  structures: string;
  windows: string;
} {
  const dir = siteDataDir(site);
  return {
    city: `${dir}/cityjson/${cityJsonFile(tile)}`,
    doors: `${dir}/dlm/doors_${tile}.geojson`,
    dormers: `${dir}/dlm/dormers_${tile}.geojson`,
    osmBuild: `${dir}/dlm/osmbuild_${tile}.json`,
    plinths: `${dir}/dlm/plinths_${tile}.geojson`,
    measuredRoofs: `${dir}/dlm/roofs_${tile}.geojson`,
    roofColor: `${dir}/dop/roofcolor_${tile}.json`,
    shopfronts: `${dir}/dlm/shopfronts_${tile}.json`,
    smallBuild: `${dir}/dlm/smallbuild_${tile}.geojson`,
    structures: `${dir}/dlm/structures_${tile}.geojson`,
    landmarks: `${dir}/dlm/landmarks_${tile}.json`,
    windows: `${dir}/dlm/windows_${tile}.json`,
  };
}

export interface TileArtifact {
  /** for a downsampled raster: the committed full-size file it is baked
   *  from (under data/<site>/dlm/) and its edge (px) */
  bakedFrom?: { file: string; raster: number };
  /** made by prepare-data.ts from other side files: nothing committed */
  built?: true;
  /** file name under public/data (before content hashing) */
  file: string;
  /** false = the loader treats a missing file as "feature off" */
  required: boolean;
}

/** The edge of the class raster the minimap and the soundscape read: the
 *  minimap paints 256² per tile, the soundscape keeps 512². */
export const SMALL_RASTER_PX = 512;

/**
 * One row per side file. Besides its name, a row says where the viewer
 * finds it — `dressing`: named in the fine terrain's dressing extras
 * (tile-stream.ts fetches it per tile); `coarse`: named in the coarse
 * terrain's, for what must show beyond the fine level's reach; `sound`: named in the tileset's
 * tile list for the soundscape (plan 035); `ask`: named there for the
 * inquiry card (ADR 0042), fetched only when something is asked — and
 * `osm`: the file is derived
 * from OpenStreetMap, so its JSON carries the ODbL credit (checked over
 * every committed file by features.test.ts). The raster rows the terrain
 * reads are named by prepare-data.ts's terrain extras.
 */
interface ArtifactSpec {
  ask?: true;
  bakedFrom?: { file: (tile: string) => string; raster: number };
  built?: true;
  /** named in the coarse terrain's extras: what that level is dressed with */
  coarse?: true;
  dressing?: true;
  file: (tile: string) => string;
  osm?: true;
  required?: true;
  sound?: true;
}

const named =
  (stem: string, ext: string) =>
  (tile: string): string =>
    `${stem}_${tile}.${ext}`;

const ARTIFACTS = {
  landcover: { file: named("landcover", "png"), required: true },
  // The edge phones get (MOBILE_RASTER_PX), downsampled (NEAREST) by
  // prepare-data from the committed 4096² raster.
  landcoverLow: {
    file: (tile) => `landcover_${tile}.r${MOBILE_RASTER_PX}.png`,
    required: true,
    bakedFrom: { file: named("landcover", "png"), raster: MOBILE_RASTER_PX },
  },
  // The coarse level's (COARSE_RASTER_PX), on every tier.
  landcoverCoarse: {
    file: (tile) => `landcover_${tile}.r${COARSE_RASTER_PX}.png`,
    required: true,
    bakedFrom: { file: named("landcover", "png"), raster: COARSE_RASTER_PX },
  },
  // The minimap's and the soundscape's class raster: 1/16 of the phone
  // raster's pixels, which is all either of them keeps.
  landcoverSmall: {
    file: (tile) => `landcover_${tile}.r${SMALL_RASTER_PX}.png`,
    required: true,
    bakedFrom: { file: named("landcover", "png"), raster: SMALL_RASTER_PX },
  },
  vegrows: {
    file: named("vegrows", "geojson"),
    required: true,
    dressing: true,
  },
  // Optional: the canopy bake skips a tile without DOM1 (rows still plant).
  canopy: { file: named("canopy", "geojson"), dressing: true },
  ndvi: { file: named("ndvi", "png") },
  // Optional: the OSM paving raster (pipeline/bake/surface.py); without
  // it the ground draws the land-cover class's default pattern.
  surface: { file: named("surface", "png"), sound: true },
  // Optional: the smoothed road/meadow edge distances
  // (pipeline/bake/edges.py); without them the shader reads the class
  // texels (kerb band only, no parking lanes).
  edges: { file: named("edges", "png") },
  // Optional: the OSM sports grounds (pipeline/bake/sport.py) — the index
  // raster and the table of grounds it names; without them the ground
  // under a pitch is its land-cover class.
  sport: { file: named("sport", "png") },
  sportTable: { file: named("sport", "json"), osm: true },
  // Optional: the sky-view factor and the far horizon
  // (pipeline/bake/skyview.py, from the committed DGM + LoD2): the
  // ambient light the city lets through and the long shadows past the
  // shadow map. Without them the light is as before.
  svf: { file: named("svf", "png"), sound: true },
  horizon: { file: named("horizon", "png") },
  // Optional: what street photos say about each building's facade
  // (lib/city/facade-reading.ts; Mapillary, CC BY-SA 4.0): the clay's
  // relief, tone and shop plinth. Without it the facades are as before.
  facades: { file: named("facades", "json") },
  // Optional: the road markings (pipeline/bake/markings.py) — the index
  // raster (rows, lane bits, centre offset) and the table of crossings
  // and stop lines; without them the roads stay unpainted.
  markings: { file: named("markings", "png") },
  // The same at 1024² for phones (`lowRasters`): 4 MiB of GPU memory
  // instead of 16, the table's rows still resolved (a wider core).
  markingsLow: { file: named("markings_low", "png") },
  markingsTable: { file: named("markings", "json"), osm: true },
  // Optional: allotment colonies, orchards and vineyards
  // (pipeline/bake/cultivated.py) — the features (orchard trees, vine
  // rows) and the colony raster the ground paints beds on.
  cultivated: {
    file: named("cultivated", "geojson"),
    dressing: true,
    osm: true,
  },
  cultivatedRaster: { file: named("cultivated", "png") },
  lamps: { file: named("lamps", "geojson"), dressing: true, osm: true },
  // Basis-DLM monuments, plus the OSM fountain basins where the tile has
  // them: the bake credits OSM only then, so the row is not `osm`.
  monuments: {
    file: named("monuments", "geojson"),
    dressing: true,
    sound: true,
  },
  furniture: { file: named("furniture", "geojson"), dressing: true, osm: true },
  // Optional: the lamps and bins OSM lacks, from Mapillary's detected
  // objects (pipeline/bake/mapillary.py, CC BY-SA — its own file, never
  // merged into OSM's); stood with the lamps and the furniture.
  mly: { file: named("mly", "geojson"), dressing: true },
  rail: { file: named("rail", "geojson"), dressing: true },
  bridge: {
    file: named("bridge", "geojson"),
    dressing: true,
    coarse: true,
    osm: true,
  },
  railarea: { file: named("railarea", "geojson"), dressing: true },
  platform: { file: named("platform", "geojson"), dressing: true, osm: true },
  // Optional: the OSM trams — tracks, catenary supports, stop signs
  // (pipeline/bake/tram.py); without it the tile has no trams.
  tram: {
    file: named("tram", "geojson"),
    dressing: true,
    sound: true,
    osm: true,
  },
  // Optional: the OSM landing stages, groynes and ferry lines
  // (pipeline/bake/riverside.py); a tile without the river has none.
  riverside: { file: named("riverside", "geojson"), dressing: true, osm: true },
  // Optional: the bell towers (pipeline/bake/soundmarks.py) the hidden
  // soundscape strikes the hour from (plan 035); fetched only while it
  // plays.
  soundmarks: { file: named("soundmarks", "geojson"), sound: true, osm: true },
  // Optional: the street-tree cadastre (pipeline/bake/trees.py), the OSM
  // hedges and the laser-scan crowns outside the canopy mask
  // (pipeline/bake/lowveg.py; only tiles with a laser scan have them).
  trees: { file: named("trees", "geojson"), dressing: true },
  // What the card says about those trees (species, location, age, the
  // measured sizes) — fetched with the first question about a tree on the
  // tile (ADR 0042), never to draw.
  treeFacts: { file: named("treefacts", "json"), ask: true },
  // Optional: the city's counted motor traffic per road section
  // (pipeline/bake/traffic.py); drawn only while its data layer is on.
  traffic: {
    file: named("traffic", "geojson"),
    dressing: true,
    coarse: true,
  },
  lowveg: { file: named("lowveg", "geojson"), dressing: true, osm: true },
  canopyx: { file: named("canopyx", "geojson"), dressing: true },
  // The coarse level's trees, a third of them (lib/city/coarse-crowns.ts):
  // baked by prepare-data.ts from the tree files above, no committed
  // source.
  crowns: {
    file: (tile) => `crowns_${tile}.crw.gz`,
    built: true,
    coarse: true,
  },
} as const satisfies Record<string, ArtifactSpec>;

type Specs = typeof ARTIFACTS;
export type TileArtifactKind = keyof Specs;
type Flag = "ask" | "coarse" | "dressing" | "osm" | "sound";
type KindsWith<F extends Flag> = {
  [K in TileArtifactKind]: Specs[K] extends Record<F, true> ? K : never;
}[TileArtifactKind];
/** The side files named in a fine terrain's dressing extras. */
export type DressingKind = KindsWith<"dressing">;
/** The side files the soundscape fetches. */
export type SoundKind = KindsWith<"sound">;

const kindsWith = <F extends Flag>(flag: F) =>
  (Object.keys(ARTIFACTS) as TileArtifactKind[]).filter(
    (kind) => (ARTIFACTS[kind] as ArtifactSpec)[flag]
  ) as KindsWith<F>[];

export const DRESSING_KINDS: readonly DressingKind[] = kindsWith("dressing");
/**
 * The side files the coarse terrain level is dressed with: only what must
 * show beyond the fine level's reach — the counted traffic (a data layer
 * read from the air, which stopped at every tile the fine level had not
 * reached yet), the bridges, which it rides and which the coarse level
 * draws (the buildings leave LoD2's bridge slabs out), and its own trees,
 * a third of the fine level's (lib/city/coarse-crowns.ts).
 */
export type CoarseDressingKind = KindsWith<"coarse">;
export const COARSE_DRESSING_KINDS: readonly CoarseDressingKind[] =
  kindsWith("coarse");
export const SOUND_KINDS: readonly SoundKind[] = kindsWith("sound");
/** The side files only the inquiry card fetches. */
export type AskKind = KindsWith<"ask">;
export const ASK_KINDS: readonly AskKind[] = kindsWith("ask");
/** Side files derived from OSM (their JSON must carry the ODbL credit). */
export const OSM_KINDS: readonly TileArtifactKind[] = kindsWith("osm");

/** The files of `kinds` a tile has, by kind (absent ones left out: an absent
 *  file is a feature off, never a request that can only 404). */
export function pickFiles<K extends TileArtifactKind>(
  names: Partial<Record<TileArtifactKind, string>>,
  kinds: readonly K[]
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const kind of kinds) {
    const name = names[kind];
    if (name) {
      out[kind] = name;
    }
  }
  return out;
}

/**
 * Every side file of a tile — the ONE list scripts/prepare-data.ts publishes
 * and names in the tile's glTF extras and the tileset. Under
 * data/<site>/dlm/, except the class rasters with `bakedFrom`, which
 * prepare-data downsamples (NEAREST) from the committed 4096² one.
 */
export function tileArtifacts(
  tile: string
): Record<TileArtifactKind, TileArtifact> {
  const out = {} as Record<TileArtifactKind, TileArtifact>;
  for (const kind of Object.keys(ARTIFACTS) as TileArtifactKind[]) {
    const spec: ArtifactSpec = ARTIFACTS[kind];
    out[kind] = {
      file: spec.file(tile),
      required: spec.required === true,
      ...(spec.built ? { built: true as const } : {}),
      ...(spec.bakedFrom
        ? {
            bakedFrom: {
              file: spec.bakedFrom.file(tile),
              raster: spec.bakedFrom.raster,
            },
          }
        : {}),
    };
  }
  return out;
}

/** Where a side file's source lives (`tileArtifacts` names the file). */
export function sideFileSource(site: Site, file: string): string {
  return `${siteDataDir(site)}/dlm/${file}`;
}

/** The OSM walls (pipeline/bake/walls.py): a terrain bake input under
 *  data/<site>/dlm/ — burned into the ground as breaklines, and stood as
 *  ribbons in the fine terrain glTF — never served. */
export function wallSourceFile(site: Site, tile: string): string {
  return `${siteDataDir(site)}/dlm/walls_${tile}.geojson`;
}

/** The kerb lines (pipeline/bake/edges.py): a terrain bake input under
 *  data/<site>/dlm/ — the fine terrain glTF stands a kerb stone on them —
 *  never served. */
export function kerbSourceFile(site: Site, tile: string): string {
  return `${siteDataDir(site)}/dlm/kerbs_${tile}.geojson`;
}

/** The stairs (pipeline/bake/stairs.py): a terrain bake input under
 *  data/<site>/dlm/ — the fine terrain glTF carries them — never served. */
export function stairSourceFile(site: Site, tile: string): string {
  return `${siteDataDir(site)}/dlm/stairs_${tile}.geojson`;
}

/** The terraces (raised OSM areas, pipeline/bake/stairs.py): a terrain
 *  bake input under data/<site>/dlm/, never served. */
export function terraceSourceFile(site: Site, tile: string): string {
  return `${siteDataDir(site)}/dlm/terraces_${tile}.geojson`;
}

/** The DGM GeoTIFF (+ its .tfw sidecar) the heightfield bake reads. */
export function dgmSourceFiles(
  site: Site,
  tile: string
): { tif: string; tfw: string } {
  const dir = `${siteDataDir(site)}/dgm/dgm1_${tile}_tiff`;
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
