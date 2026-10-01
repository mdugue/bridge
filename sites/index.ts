import type { Site } from "@/lib/city/site";
import { BERLIN } from "./berlin";
import { DRESDEN } from "./dresden";
import { GRIMMA } from "./grimma";
import { HAMBURG } from "./hamburg";
import { LEIPZIG } from "./leipzig";
import { MEISSEN } from "./meissen";
import { MUENCHEN } from "./muenchen";
import { UNNA } from "./unna";

/** Every site this repo can build, by id: the route it is served under
 *  (`/dresden`) and the first argument of `bun run fetch|bake|site`. Add one
 *  here and in its own file. */
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

/** The reference site: its data is committed, the knowledge base (/wissen)
 *  describes it, and the checks that need one real place measure it. */
export const REFERENCE_SITE: SiteId = "dresden";

export function isSiteId(id: string): id is SiteId {
  return Object.hasOwn(SITES, id);
}

/** The site with this id (a route segment, a command-line argument). */
export function siteById(id: string): Site | undefined {
  return isSiteId(id) ? SITES[id] : undefined;
}

/**
 * The site a command names as its first argument (`bun run bake leipzig
 * --step rail`), and the arguments after it. Throws with the known ids when
 * the first argument names none, so a typo never runs against another place.
 */
export function siteFromArgs(args: readonly string[]): {
  site: Site;
  rest: string[];
} {
  const [first, ...rest] = args;
  const site = first === undefined ? undefined : siteById(first);
  if (!site) {
    throw new Error(
      `name the site first (${first === undefined ? "none given" : `"${first}" is none`}); known: ${Object.keys(SITES).join(", ")}`
    );
  }
  return { site, rest };
}
