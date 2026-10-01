/**
 * One deployment serves every site whose data is ready, each under its own
 * route (`/dresden`) and its own data folder (`/data/dresden/`), and the
 * index of them (`/data/sites.json`) is what the start page and the route's
 * static params read. Written by scripts/prepare-sites.ts; pure, no DOM.
 */

import { parseSiteStats, type SiteStats } from "./site-stats";

/** The index of built sites, at the root of the data folder. */
export const SITE_INDEX_FILE = "sites.json";

/** The site's land cover as one map picture (scripts/bake-wissen-hero.ts):
 *  the start page's card and the knowledge base's hero. */
export const SITE_MAP_FILE = "site-map.webp";

export interface SiteIndexEntry {
  id: string;
  /** the city in numbers (lib/city/site-stats.ts), for the start page's
   *  orderings */
  stats?: SiteStats;
  /** the map picture's served path (`/data/<id>/site-map.<hash>.webp`), when
   *  the land cover was there to paint it */
  map?: string;
}

export interface SiteIndex {
  sites: SiteIndexEntry[];
  version: 1;
}

/** Where a site's files are served from: its manifest and everything the
 *  manifest names. */
export function siteDataBase(id: string): string {
  return `/data/${id}`;
}

/** The index, or null when it is not one (an old or foreign file). */
export function parseSiteIndex(value: unknown): SiteIndex | null {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { version?: unknown }).version !== 1 ||
    !Array.isArray((value as { sites?: unknown }).sites)
  ) {
    return null;
  }
  const sites = (value as { sites: unknown[] }).sites
    .filter(
      (s): s is SiteIndexEntry =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as { id?: unknown }).id === "string"
    )
    .map(({ stats, ...entry }) => {
      const parsed = parseSiteStats(stats);
      return parsed ? { ...entry, stats: parsed } : entry;
    });
  return { version: 1, sites };
}
