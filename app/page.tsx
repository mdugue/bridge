import type { Metadata, Viewport } from "next";
import { siteTitle } from "@/lib/city/site";
import { currentSite } from "@/sites";
import { CityWalkClient } from "./_components/city-walk-client";

const site = currentSite();

export const metadata: Metadata = {
  title: siteTitle(site),
  description: `${site.name} zum Durchlaufen: ein 3D-Stadtmodell aus offenen Geodaten, mit Gelände, Sonne und Schatten`,
};

// App-like fullscreen canvas: no pinch-zooming the page itself (the canvas
// has its own pinch gesture) and stretch under notches.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function HomePage() {
  return (
    <main className="h-dvh w-full">
      <CityWalkClient />
    </main>
  );
}
