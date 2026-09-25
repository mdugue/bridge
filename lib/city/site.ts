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
  /**
   * The id of the viewpoint the player starts at. It must lie on the first
   * tile: that one is always streamed (the lite profile streams it alone)
   * and the boot waits for it.
   */
  spawn: string;
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

/** The viewpoint a site starts at (its `spawn`). */
export function spawnViewpoint(site: Site): Viewpoint {
  const view = site.viewpoints.find((v) => v.id === site.spawn);
  if (!view) {
    throw new Error(`site ${site.id}: spawn "${site.spawn}" is no viewpoint`);
  }
  return view;
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
