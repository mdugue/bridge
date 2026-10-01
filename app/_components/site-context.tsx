"use client";

import { createContext, type ReactNode, use } from "react";
import type { Site } from "@/lib/city/site";

interface SiteValue {
  /** the other sites this deployment serves (their routes exist) */
  others: readonly Site[];
  site: Site;
}

const SiteContext = createContext<SiteValue | null>(null);

/** The site the route renders (/dresden), for every HUD part under it, and
 *  the other sites the deployment serves. */
export function SiteProvider({
  children,
  others = [],
  site,
}: {
  children: ReactNode;
  others?: readonly Site[];
  site: Site;
}) {
  return <SiteContext value={{ others, site }}>{children}</SiteContext>;
}

function useSiteValue(): SiteValue {
  const value = use(SiteContext);
  if (!value) {
    throw new Error("useSite outside a SiteProvider");
  }
  return value;
}

/** The site the viewer shows. Only valid under the route's SiteProvider. */
export function useSite(): Site {
  return useSiteValue().site;
}

/** The deployment's other sites (the off-site dialog offers to go there). */
export function useOtherSites(): readonly Site[] {
  return useSiteValue().others;
}
