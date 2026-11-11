import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseSiteIndex,
  SITE_INDEX_FILE,
  siteDataBase,
} from "@/lib/city/site-index";
import { MANIFEST_FILE, manifestUrl } from "@/lib/city/tile";
import type { DataManifest } from "@/lib/city/tile";
import { TILESET_FILE } from "@/lib/city/tileset";
import type { SiteIndexEntry } from "@/lib/city/site-index";
import type { Site } from "@/lib/city/site";
import type { SiteStats } from "@/lib/city/site-stats";
import { REFERENCE_SITE, siteById } from "@/sites";

export interface BuiltSite {
  /** the land-cover map picture's served path, when it was baked */
  map?: string;
  site: Site;
  /** the city in numbers, when the build measured it */
  stats?: SiteStats;
}

/**
 * The sites this deployment serves: the ones scripts/prepare-sites.ts built
 * into public/data (its index, sites.json), in the registry's terms. Read
 * at build time — the routes are prerendered from it. Without an index (a
 * checkout that never ran the build step) the reference site stands in, so
 * the route still has its one static param.
 */
export function builtSites(): BuiltSite[] {
  let entries: SiteIndexEntry[] = [{ id: REFERENCE_SITE }];
  try {
    const index = parseSiteIndex(
      JSON.parse(
        readFileSync(
          path.join(process.cwd(), "public", "data", SITE_INDEX_FILE),
          "utf-8"
        )
      )
    );
    if (index && index.sites.length > 0) {
      entries = index.sites;
    }
  } catch {
    // no index yet: the reference site alone
  }
  return entries.flatMap(({ id, map, stats }) => {
    const site = siteById(id);
    return site ? [{ site, map, stats }] : [];
  });
}

/** The built site with this id, or undefined (unknown, or not built here). */
export function builtSite(id: string): BuiltSite | undefined {
  return builtSites().find((b) => b.site.id === id);
}

/**
 * What a site's viewer fetches first, as served paths: its manifest, and
 * the tileset that manifest names (the whole site's: what every profile
 * but `?scene=lite` and a safety fallback streams). The page preloads
 * them, so they are on their way before its scripts run; the viewer still
 * reads the manifest itself (city-walk-client.tsx). Without a manifest (a
 * checkout that never ran the build step) nothing.
 */
export function firstFetches(id: string): string[] {
  const base = siteDataBase(id);
  try {
    const manifest = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "public", "data", id, MANIFEST_FILE),
        "utf-8"
      )
    ) as DataManifest;
    const tileset = manifest.files[TILESET_FILE];
    return [
      `${base}/${MANIFEST_FILE}`,
      ...(tileset ? [manifestUrl(manifest, TILESET_FILE, base)] : []),
    ];
  } catch {
    return [];
  }
}
