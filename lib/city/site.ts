/**
 * A site: the place the viewer renders and everything about it that is not
 * data — its name, where its tiles are, where to spawn and its curated
 * vantages — plus the data provider it draws on. The registry is
 * `sites/index.ts`; one deployment serves every site whose data was built,
 * each under its own route (`/dresden`), all prerendered, so the app stays
 * a static bundle (ADR 0001, 0037). No THREE, no DOM.
 *
 * What belongs to the Land rather than the place — CRS, licence and credit,
 * which products are open, the OSM extract — is the `Provider`, shared by
 * every site of that Land (ADR 0037).
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
  /** the Land it surveys, as the start page names it */
  land: string;
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
    /** a classified laser scan (LAZ) per tile, the adapter's `lsc` —
     *  hedge heights and the trees outside the canopy mask; opt-in
     *  (`bun run fetch --lsc`, ≈380 MB a tile) */
    lsc: boolean;
  };
  /** suffix of tile ids (`33412_5656_2_sn`), after the provider */
  tileSuffix: string;
}

/**
 * The municipal tree registers pipeline/bake/cadastre.py knows: each is a
 * WFS query plus the mapping of its fields (taxon, height, crown, trunk …)
 * onto the bake's one tree record.
 */
export const TREE_REGISTERS = [
  "berlin",
  "dresden",
  "hamburg",
  "leipzig",
] as const;

/**
 * A municipal street-tree register the site can use (surveyed trees with
 * taxon, crown and mostly height). `id` names its entry in
 * pipeline/bake/cadastre.py; `credit` is its licence's credit line.
 */
export interface TreeCadastre {
  credit: string;
  id: (typeof TREE_REGISTERS)[number];
}

/** The traffic-count sources pipeline/bake/traffic_sources.py knows: a
 *  city's own counts, or a Land's road census. */
export const TRAFFIC_SOURCES = [
  "berlin",
  "dresden",
  "hamburg",
  "nrw",
  "saxony-svz",
] as const;

/** The live bicycle-counter feeds lib/city/bike-counts.ts reads. */
export const BIKE_FEEDS = ["dresden", "hamburg"] as const;

/**
 * The data layers a site has (lib/city/data-layers.ts; ADR 0040): which
 * sources feed them, and each source's licence credit. A layer the site
 * does not name is not offered in the HUD.
 */
export interface SiteDataLayers {
  /** the counted motor traffic per road section (baked per tile) */
  traffic?: { credit: string; source: (typeof TRAFFIC_SOURCES)[number] };
  /** the live bicycle counters (read by the browser) */
  bikes?: { credit: string; feed: (typeof BIKE_FEEDS)[number] };
  /** the trams by timetable (GTFS, baked once for the site); `operator`
   *  as the HUD names it ("DVB") */
  trams?: { operator: string };
}

export interface Site {
  /** the data layers the site offers, when it has any */
  dataLayers?: SiteDataLayers;
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
  /** the city's street-tree register, where it publishes one openly */
  treeCadastre?: TreeCadastre;
  /**
   * Whether the site adds the street lamps and litter bins OSM lacks from
   * Mapillary's detected objects (pipeline/bake/mapillary.py; CC BY-SA, so
   * its credit joins the footer).
   */
  mapillary?: boolean;
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

/** What every site takes from OSM, as the HUD credit names it. */
const OSM_LAYERS =
  "Lampen, Bänke, Ampeln, Hydranten, Uhren, Litfaßsäulen, Brunnen, Mauern, Zäune, Hecken, Treppen, Plätze, Beläge, Fahrbahnmarkierungen, Sportplätze, Kleingärten, Obstwiesen, Weinberge, Bahnsteige, Straßenbahn, Anlegestellen, Brücken, Läden, Baudenkmale und Kirchtürme";
const OSM_LICENCE = "© OpenStreetMap-Mitwirkende (ODbL)";

/** The OSM credit, naming what the site takes from OSM (the land cover too
 *  where the provider has no open Basis-DLM). */
function osmCredit(site: Site): string {
  const layers = site.provider.products.dlm
    ? OSM_LAYERS
    : `Landbedeckung, ${OSM_LAYERS}`;
  return `${layers} ${OSM_LICENCE}`;
}

/** The street-tree register's credit; the trees bake adds the OSM trees the
 *  register does not cover (pipeline/bake/trees.py). */
function treeCredit(cadastre: TreeCadastre): string {
  return `${cadastre.credit}; weitere Bäume ${OSM_LICENCE}`;
}

/** The credit of the land cover (what the ground is painted from): the
 *  provider's Basis-DLM, or without one OpenStreetMap. */
export function landcoverCredit(site: Site): string {
  return site.provider.products.dlm
    ? `Basis-DLM, ${site.provider.credit}`
    : `OpenStreetMap, ${OSM_LICENCE}`;
}

/** A provider as a credit names it: "GeoSN", "Geobasis NRW", "LGV" — the
 *  name before its parenthesis when that is short, else what the
 *  parenthesis holds. */
function shortName(provider: Provider): string {
  const m = provider.name.match(/^(.*?) \((.*)\)$/);
  if (!m) {
    return provider.name;
  }
  return m[1].length <= 20 ? m[1] : m[2];
}

/** A source's credit line ("Stadtbäume: Landeshauptstadt Dresden,
 *  dl-de/by-2-0") as its holder and licence. */
function registerHolder(credit: string): [string, string] {
  const body = credit.replace(/^[^:]*:\s*/, "");
  const cut = body.lastIndexOf(", ");
  return cut < 0 ? [body, ""] : [body.slice(0, cut), body.slice(cut + 2)];
}

/**
 * The short credit the HUD footer always shows (its full lines,
 * `siteAttribution`, fold behind it): every licensor and licence named
 * once — "GeoSN, Landeshauptstadt Dresden (dl-de/by-2-0) · © OpenStreetMap
 * (ODbL)".
 */
export function siteCredit(site: Site): string {
  const byLicence = new Map<string, string[]>();
  const add = (holder: string, licence: string) => {
    const holders = byLicence.get(licence) ?? [];
    if (!holders.includes(holder)) {
      holders.push(holder);
    }
    byLicence.set(licence, holders);
  };
  add(shortName(site.provider), site.provider.licence);
  for (const credit of dataCredits(site)) {
    add(...registerHolder(credit));
  }
  const parts = [...byLicence].map(([licence, holders]) =>
    licence ? `${holders.join(", ")} (${licence})` : holders.join(", ")
  );
  return [...parts, "© OpenStreetMap (ODbL)"].join(" · ");
}

/** The daily curve the traffic keeps its hours by (lib/city/
 *  traffic-hours.ts), and the timetable the trams run by. */
export const TRAFFIC_HOURS_CREDIT =
  "Tagesgang: Freie und Hansestadt Hamburg, dl-de/by-2-0";
export const TIMETABLE_CREDIT =
  "Straßenbahn-Fahrplan: DELFI e.V. via gtfs.de, CC BY 4.0";

/** The credit of Mapillary's lamps and bins (`Site.mapillary`). */
export const MAPILLARY_CREDIT = "Lampen, Mülleimer: Mapillary, CC BY-SA 4.0";

/** The credits of the site's registers and data layers, each a
 *  "what: holder, licence" line. */
function dataCredits(site: Site): string[] {
  const layers = site.dataLayers;
  return [
    ...(site.treeCadastre ? [site.treeCadastre.credit] : []),
    ...(site.mapillary ? [MAPILLARY_CREDIT] : []),
    ...(layers?.traffic ? [layers.traffic.credit, TRAFFIC_HOURS_CREDIT] : []),
    ...(layers?.bikes ? [layers.bikes.credit] : []),
    ...(layers?.trams ? [TIMETABLE_CREDIT] : []),
  ];
}

/** The credit lines the HUD footer shows (the sources' licence terms). */
export function siteAttribution(site: Site): string[] {
  const layers = site.dataLayers;
  const data = [
    ...(layers?.traffic ? [layers.traffic.credit, TRAFFIC_HOURS_CREDIT] : []),
    ...(layers?.bikes ? [layers.bikes.credit] : []),
    ...(layers?.trams ? [TIMETABLE_CREDIT] : []),
  ];
  return [
    site.provider.credit,
    osmCredit(site),
    ...(site.treeCadastre ? [treeCredit(site.treeCadastre)] : []),
    ...(site.mapillary ? [MAPILLARY_CREDIT] : []),
    ...(data.length > 0 ? [data.join(" · ")] : []),
  ];
}

/** The Geofabrik URL of the site's OSM extract. */
export function osmExtractUrl(site: Site): string {
  return `https://download.geofabrik.de/${site.osm ?? site.provider.osm}-latest.osm.pbf`;
}
