import type { Site } from "@/lib/city/site";
import { DRESDEN } from "./dresden";

/** Every site this repo can build. Add one here and in its own file. */
export const SITES: Record<string, Site> = { dresden: DRESDEN };

/**
 * The site this build renders: `SITE` at build time (next.config.ts inlines
 * it for the client as NEXT_PUBLIC_SITE; the bake scripts read SITE).
 */
export function currentSite(): Site {
  const id = process.env.NEXT_PUBLIC_SITE ?? process.env.SITE ?? "dresden";
  const site = SITES[id];
  if (!site) {
    throw new Error(
      `unknown site "${id}" (known: ${Object.keys(SITES).join(", ")})`
    );
  }
  return site;
}
