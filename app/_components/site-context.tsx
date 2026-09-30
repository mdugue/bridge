"use client";

import { createContext, type ReactNode, use } from "react";
import type { Site } from "@/lib/city/site";

const SiteContext = createContext<Site | null>(null);

/** The site the route renders (/dresden), for every HUD part under it. */
export function SiteProvider({
  children,
  site,
}: {
  children: ReactNode;
  site: Site;
}) {
  return <SiteContext value={site}>{children}</SiteContext>;
}

/** The site the viewer shows. Only valid under the route's SiteProvider. */
export function useSite(): Site {
  const site = use(SiteContext);
  if (!site) {
    throw new Error("useSite outside a SiteProvider");
  }
  return site;
}
