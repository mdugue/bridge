/**
 * A site: the place the viewer renders and everything about it that is not
 * data — its name, where its tiles are, where to spawn and its curated
 * vantages — plus the data provider it draws on. One site is compiled in
 * per build (`SITE=<id>`, from `.env.local` or the host's environment; the
 * registry is `sites/index.ts`), so the app stays a static bundle
 * (ADR 0001). No THREE, no DOM.
 *
 * What belongs to the Land rather than the place — CRS, licence and credit,
 * which products are open, the OSM extract — is the `Provider`, shared by
 * every site of that Land (ADR 0028).
 */

export type MovementMode = "fly" | "walk";

/**
 * A curated vantage the camera can glide to from the HUD, authored in the
 * site's projected CRS (so a coordinate can be eyeballed on a map) plus a
 * height *above the terrain* — the camera resolves the real ground at
 * runtime, so a viewpoint stays correct even if the terrain changes.
 * `mode` is where the player lands.
 */
export interface Viewpoint {
  /** metres above the terrain at `epsg` (≈ eye height for walk views) */
  aboveGround: number;
  description: string;
  /** projected ground position the camera sits at / hovers above */
  epsg: { x: number; y: number };
  fov: number;
  /** compass degrees, 0 = north, clockwise (east) — matches CameraState */
  headingDeg: number;
  id: string;
  label: string;
  mode: MovementMode;
  /** + = looking up, − = looking down */
  pitchDeg: number;
}

/**
 * A vantage stripped of the copy that names it. The glide only ever reads the
 * geometry, and the view you save yourself has no label of its own — it is
 * wherever you happen to be standing.
 */
export type ViewpointGeometry = Omit<Viewpoint, "description" | "id" | "label">;

/**
 * An aerial vantage over a landmark, authored the way you would frame it:
 * WHAT to look at, from which compass direction, how steeply and how high.
 * The camera stands back from `target` along `headingDeg` by
 * `altitude / tan(−pitch)` so the landmark sits under the crosshair (on
 * level ground; the DGM's few metres of relief barely move it). The result
 * is an ordinary fly-mode Viewpoint.
 */
export function overlook(
  target: { x: number; y: number },
  frame: {
    /** metres above the terrain */
    altitude: number;
    description: string;
    fov?: number;
    headingDeg: number;
    id: string;
    label: string;
    /** degrees below the horizon, negative (−90 = straight down) */
    pitchDeg: number;
  }
): Viewpoint {
  const { altitude, headingDeg, pitchDeg } = frame;
  if (!(pitchDeg < 0)) {
    throw new Error(`overlook ${frame.id}: pitch must look down`);
  }
  const back = altitude / Math.tan((-pitchDeg * Math.PI) / 180);
  const heading = (headingDeg * Math.PI) / 180;
  return {
    id: frame.id,
    label: frame.label,
    description: frame.description,
    mode: "fly",
    epsg: {
      x: Math.round(target.x - Math.sin(heading) * back),
      y: Math.round(target.y - Math.cos(heading) * back),
    },
    aboveGround: altitude,
    headingDeg,
    pitchDeg,
    fov: frame.fov ?? 60,
  };
}

/** A tile of the site's grid by its south-west corner, in km. */
export interface TileCell {
  e: number;
  n: number;
}

/** Edge of every tile, km. The rasters (4096² classes, 1024² terrain) and
 *  the phone budgets are sized for it; providers with another download grid
 *  are cut to it by their fetch adapter. */
export const TILE_KM = 2;

/** The ingest adapters that exist (pipeline/bake/providers/<id>.py). */
export type ProviderId = "be" | "by" | "hh" | "nw" | "sn";

/**
 * A data provider — in Germany the Land's surveying office — and what it
 * publishes as open data. DGM1 and LoD2 are required of every provider;
 * the rest degrades (docs/portability.md#degradation-matrix).
 */
export interface Provider {
  /** the credit line its licence requires, in the HUD footer */
  credit: string;
  /** ETRS89 / UTM: 25832 (zone 32) or 25833 (zone 33) — one per Land */
  epsg: 25832 | 25833;
  id: ProviderId;
  /** licence of its products (SPDX-like short name) */
  licence: string;
  /** the office, as people know it */
  name: string;
  /** Geofabrik extract covering the Land, path under download.geofabrik.de
   *  without `-latest.osm.pbf` (e.g. "europe/germany/sachsen") */
  osm: string;
  /** the portal a person would start from */
  portal: string;
  /** the optional products it publishes openly */
  products: {
    /** a surface model (tree heights, bridge decks), fetched as 1 m */
    dom: boolean;
    /** orthophoto bands: "rgbi" feeds roof colours and NDVI, "rgb" roof
     *  colours only */
    dop: "rgb" | "rgbi" | null;
    /** ATKIS Basis-DLM in the AdV Shape profile (land cover, tree rows,
     *  rails, bridge decks); without it land cover comes from OSM */
    dlm: boolean;
  };
  /** suffix of tile ids (`33412_5656_2_sn`), after the provider */
  tileSuffix: string;
}

export interface Site {
  /** where the sun is computed when the tiles cannot be reprojected */
  fallbackLatLng: { lat: number; lng: number };
  /** the `SITE` value and the data folder, `data/<id>/` */
  id: string;
  /** the place and the part of it shown, as the HUD names it
   *  ("Dresden · Altstadt") */
  label: string;
  /** the place alone ("Dresden"): page titles, the knowledge base */
  name: string;
  /** a smaller Geofabrik extract than the provider's, when one covers the
   *  site (same form as `Provider.osm`) */
  osm?: string;
  provider: Provider;
  /**
   * The id of the viewpoint the player starts at. It must lie on the first
   * tile: that one is always streamed (the lite profile streams it alone)
   * and the boot waits for it.
   */
  spawn: string;
  /** the tiles to fetch, bake and load; the FIRST is where the player spawns */
  tiles: TileCell[];
  viewpoints: Viewpoint[];
}

/** The viewpoint a site starts at (its `spawn`). */
export function spawnViewpoint(site: Site): Viewpoint {
  const view = site.viewpoints.find((v) => v.id === site.spawn);
  if (!view) {
    throw new Error(`site ${site.id}: spawn "${site.spawn}" is no viewpoint`);
  }
  return view;
}

/** UTM zone of an ETRS89/UTM EPSG code. */
export function utmZoneOf(epsg: Provider["epsg"]): number {
  return epsg - 25_800;
}

/**
 * A tile's id: `<zone><easting km>_<northing km>_<edge km><suffix>`, the
 * scheme Saxony's downloads use (`33412_5656_2_sn`), which every file name
 * under data/<site>/ carries. Unique across sites: it is a coordinate.
 */
export function tileIdOf(site: Site, cell: TileCell): string {
  const { epsg, tileSuffix } = site.provider;
  return `${utmZoneOf(epsg)}${cell.e}_${cell.n}_${TILE_KM}${tileSuffix}`;
}

/** A tile's projected extent [minX, minY, maxX, maxY] (m). */
export function tileExtentOf(cell: TileCell): [number, number, number, number] {
  const size = TILE_KM * 1000;
  const minX = cell.e * 1000;
  const minY = cell.n * 1000;
  return [minX, minY, minX + size, minY + size];
}

/** The page title. */
export function siteTitle(site: Site): string {
  return `City Walk — ${site.name}`;
}

/** The OSM credit, naming what the site takes from OSM. */
function osmCredit(site: Site): string {
  const layers = site.provider.products.dlm
    ? "Lampen, Mauern, Bahnsteige und Brücken"
    : "Landbedeckung, Lampen, Mauern, Bahnsteige und Brücken";
  return `${layers} © OpenStreetMap-Mitwirkende (ODbL)`;
}

/** The credit lines the HUD footer shows (the sources' licence terms). */
export function siteAttribution(site: Site): string[] {
  return [site.provider.credit, osmCredit(site)];
}

/** The Geofabrik URL of the site's OSM extract. */
export function osmExtractUrl(site: Site): string {
  return `https://download.geofabrik.de/${site.osm ?? site.provider.osm}-latest.osm.pbf`;
}
