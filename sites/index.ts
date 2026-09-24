import type { Site } from "@/lib/city/site";
import { BERLIN } from "./berlin";
import { DRESDEN } from "./dresden";
import { GRIMMA } from "./grimma";
import { HAMBURG } from "./hamburg";
import { LEIPZIG } from "./leipzig";
import { MEISSEN } from "./meissen";
import { MUENCHEN } from "./muenchen";
import { UNNA } from "./unna";

/** Every site this repo can build, by the `SITE` value that selects it. Add
 *  one here and in its own file. */
export const SITES = {
  berlin: BERLIN,
  dresden: DRESDEN,
  grimma: GRIMMA,
  hamburg: HAMBURG,
  leipzig: LEIPZIG,
  meissen: MEISSEN,
  muenchen: MUENCHEN,
  unna: UNNA,
} as const satisfies Record<string, Site>;

export type SiteId = keyof typeof SITES;

/** The site `SITE` names when it is unset (CI, a fresh clone). */
export const DEFAULT_SITE: SiteId = "dresden";

function isSiteId(id: string): id is SiteId {
  return Object.hasOwn(SITES, id);
}

/**
 * The site this build renders: `SITE`, from `.env.local` (Bun and Next load
 * it for every script and for dev/build) or the host's environment.
 * next.config.ts inlines it for the client as NEXT_PUBLIC_SITE.
 */
export function currentSite(): Site {
  const id = process.env.NEXT_PUBLIC_SITE ?? process.env.SITE ?? DEFAULT_SITE;
  if (!isSiteId(id)) {
    throw new Error(
      `unknown site "${id}" (SITE in .env.local; known: ${Object.keys(SITES).join(", ")})`
    );
  }
  return SITES[id];
}
