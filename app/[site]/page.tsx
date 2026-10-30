import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { siteTitle } from "@/lib/city/site";
import { builtSite, builtSites } from "../_lib/built-sites";
import { CityWalkClient } from "../_components/city-walk-client";

interface Props {
  params: Promise<{ site: string }>;
}

/** One page per site whose data this build prepared (public/data/sites.json). */
export function generateStaticParams(): { site: string }[] {
  return builtSites().map(({ site }) => ({ site: site.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const built = builtSite((await params).site);
  if (!built) {
    return {};
  }
  const { site } = built;
  return {
    title: siteTitle(site),
    description: `${site.name} zum Durchlaufen: ein 3D-Stadtmodell aus offenen Geodaten, mit Gelände, Sonne und Schatten`,
    alternates: { canonical: `/${site.id}` },
  };
}

// App-like fullscreen canvas: no pinch-zooming the page itself (the canvas
// has its own pinch gesture) and stretch under notches.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// The site is read inside the boundary: a link prefetches one shell for
// every city (partialPrefetching), the viewer itself comes on the click.
export default function SitePage({ params }: Props) {
  return (
    <main className="h-dvh w-full">
      <Suspense fallback={null}>
        <Viewer params={params} />
      </Suspense>
    </main>
  );
}

async function Viewer({ params }: Props) {
  // A site this build did not prepare has no data to stream: 404 rather
  // than a viewer that fails to load.
  const built = builtSite((await params).site);
  if (!built) {
    notFound();
  }
  return (
    <CityWalkClient
      builtIds={builtSites().map((b) => b.site.id)}
      siteId={built.site.id}
    />
  );
}
