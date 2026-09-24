/**
 * A site: the place the viewer renders and everything about it that is not
 * data — its name, where its tiles are, where to spawn, its curated vantages
 * and the credit line its sources require. One site is compiled in per build
 * (`SITE=<id>`, default `dresden`; the registry is `sites/index.ts`), so the
 * app stays a static bundle (ADR 0001). No THREE, no DOM.
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

/** A tile of the site's grid by its south-west corner, in km. */
export interface TileCell {
  e: number;
  n: number;
}

export interface Site {
  /** credit lines the HUD footer shows (licence terms of the sources) */
  attribution: string[];
  /** ETRS89 / UTM: 25832 (zone 32) or 25833 (zone 33) */
  epsg: 25832 | 25833;
  /** where the sun is computed when the tiles cannot be reprojected */
  fallbackLatLng: { lat: number; lng: number };
  id: string;
  /** the ingest adapter that turns the provider's downloads into the bakes'
   *  canonical raw layout (pipeline/bake/ingest_<id>.py) */
  ingest: "sn";
  /** the place, as the HUD names it ("Dresden · Altstadt") */
  label: string;
  /** optional suffix of the provider's tile names (Saxony: "_sn") */
  tileSuffix: string;
  /** edge of one tile, km */
  tileKm: number;
  /** the tiles to bake and load; the FIRST is where the player spawns */
  tiles: TileCell[];
  /** the page title */
  title: string;
  viewpoints: Viewpoint[];
}

/** UTM zone of an ETRS89/UTM EPSG code. */
export function utmZoneOf(epsg: Site["epsg"]): number {
  return epsg - 25_800;
}

/**
 * A tile's id: `<zone><easting km>_<northing km>_<edge km><suffix>`, the
 * scheme Saxony's downloads use (`33412_5656_2_sn`), which every file name
 * under data/ carries.
 */
export function tileIdOf(site: Site, cell: TileCell): string {
  return `${utmZoneOf(site.epsg)}${cell.e}_${cell.n}_${site.tileKm}${site.tileSuffix}`;
}

/** A tile's projected extent [minX, minY, maxX, maxY] (m). */
export function tileExtentOf(
  site: Site,
  cell: TileCell
): [number, number, number, number] {
  const size = site.tileKm * 1000;
  const minX = cell.e * 1000;
  const minY = cell.n * 1000;
  return [minX, minY, minX + size, minY + size];
}
