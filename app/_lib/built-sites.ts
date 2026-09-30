import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseSiteIndex,
  SITE_INDEX_FILE,
  type SiteIndexEntry,
} from "@/lib/city/site-index";
import type { Site } from "@/lib/city/site";
import { REFERENCE_SITE, siteById } from "@/sites";

export interface BuiltSite {
  /** the land-cover map picture's served path, when it was baked */
  map?: string;
  site: Site;
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
          "utf8"
        )
      )
    );
    if (index && index.sites.length > 0) {
      entries = index.sites;
    }
  } catch {
    // no index yet: the reference site alone
  }
  return entries.flatMap(({ id, map }) => {
    const site = siteById(id);
    return site ? [{ site, map }] : [];
  });
}

/** The built site with this id, or undefined (unknown, or not built here). */
export function builtSite(id: string): BuiltSite | undefined {
  return builtSites().find((b) => b.site.id === id);
}
