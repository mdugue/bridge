/**
 * What `bun run site` reports for a site: per tile, which of its inputs are
 * on disk, and the one command that moves it forward. Pure — the script
 * (scripts/site-report.ts) passes in a file check. No THREE, no DOM.
 */
import { osmExtractUrl, type Site } from "./site";
import {
  cityMeshSourceFiles,
  dgmSourceFiles,
  kerbSourceFile,
  providerRawDir,
  sideFileSource,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  tileIds,
  wallSourceFile,
} from "./tile";

export type Stage = "fetch" | "bake" | "ready";

export interface TileReport {
  /** optional artifacts that are absent (the feature is off) */
  absent: string[];
  /** files the build fails without */
  missing: string[];
  /** the command that moves the tile forward */
  next: Stage;
  tile: string;
}

/**
 * The Basis-DLM layers the bakes read (AdV Shape profile) — the same list
 * as `DLM_LAYERS` in pipeline/bake/common.py (site-report.test.ts holds
 * the two together).
 */
export const DLM_LAYERS = [
  "veg01_f",
  "veg02_f",
  "veg03_f",
  "veg04_l",
  "sie02_f",
  "gew01_f",
  "gew01_l",
  "gew02_f",
  "ver01_f",
  "ver01_l",
  "ver02_l",
  "ver03_f",
  "ver03_l",
  "ver06_f",
  "ver06_l",
  "sie03_p",
] as const;

/** What the required land cover is baked from: the complete Basis-DLM, or
 *  without one the OSM extract. The optional surface model and orthophoto
 *  do not hold a tile back — without them their features are off. */
function landCoverInputs(site: Site): string[] {
  const raw = providerRawDir(site);
  if (site.provider.products.dlm) {
    return DLM_LAYERS.flatMap((l) => [
      `${raw}/dlm/${l}.shp`,
      `${raw}/dlm/${l}.dbf`,
    ]);
  }
  return [`${raw}/osm/${osmExtractUrl(site).split("/").at(-1) ?? ""}`];
}

export function tileReport(
  site: Site,
  tile: string,
  exists: (path: string) => boolean
): TileReport {
  const sources = [
    dgmSourceFiles(site, tile).tif,
    cityMeshSourceFiles(site, tile).city,
  ];
  const artifacts = Object.values(tileArtifacts(tile)).filter(
    (a) => !a.bakedFrom
  );
  const required = artifacts
    .filter((a) => a.required)
    .map((a) => sideFileSource(site, a.file));
  const missing = [...sources, ...required].filter((p) => !exists(p));
  const absent = [
    ...artifacts
      .filter((a) => !a.required)
      .map((a) => sideFileSource(site, a.file)),
    // The building bake's optional inputs: what OSM knows per building,
    // the laser scan's small structures (never served).
    cityMeshSourceFiles(site, tile).osmBuild,
    cityMeshSourceFiles(site, tile).smallBuild,
    // The terrain bake's optional inputs (never served).
    wallSourceFile(site, tile),
    stairSourceFile(site, tile),
    terraceSourceFile(site, tile),
    kerbSourceFile(site, tile),
  ].filter((p) => !exists(p));
  const unfetched = [...sources, ...landCoverInputs(site)].some(
    (p) => !exists(p)
  );
  // Buildable is ready, even without the raw inputs (Dresden's derived
  // files are committed; its downloads need not be on this machine).
  let next: Stage = "ready";
  if (missing.length > 0) {
    next = unfetched ? "fetch" : "bake";
  }
  return { tile, missing, absent, next };
}

export function siteReport(
  site: Site,
  exists: (path: string) => boolean
): TileReport[] {
  return tileIds(site).map((tile) => tileReport(site, tile, exists));
}

/** One line per fact the report prints above the tiles. */
export function siteSummary(site: Site): string[] {
  const { products } = site.provider;
  return [
    `${site.label} — SITE=${site.id}, ${site.tiles.length} tile(s), ${site.viewpoints.length} viewpoint(s)`,
    `provider: ${site.provider.name}, EPSG:${site.provider.epsg}, ${site.provider.licence}`,
    `surface model: ${products.dom ? "yes" : "no (trees from rows only)"} · orthophoto: ${products.dop ?? "none"} · land cover from ${products.dlm ? "the Basis-DLM" : "OpenStreetMap"}`,
    `OSM extract: ${osmExtractUrl(site)}`,
  ];
}

/** Even-odd ray cast: whether (x, y) lies inside the polygon. */
export function insidePolygon(
  x: number,
  y: number,
  pts: readonly [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * What is wrong with where a walk viewpoint stands, if anything: inside a
 * building footprint (the camera spawns in a wall) or on water (it sinks to
 * the river bed — the DGM has no bridge decks either). `classAt` is the
 * land-cover class under a point, `footprints` the buildings' ground
 * polygons nearby, both in the site's CRS.
 */
export function walkViewpointIssue(
  point: { x: number; y: number },
  footprints: readonly (readonly [number, number][])[],
  classAt: (x: number, y: number) => number | null,
  waterClass: number
): string | null {
  if (footprints.some((f) => insidePolygon(point.x, point.y, f))) {
    return "inside a building";
  }
  if (classAt(point.x, point.y) === waterClass) {
    return "on water";
  }
  return null;
}
