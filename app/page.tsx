import type { Metadata, Viewport } from "next";
import { CityWalkClient } from "./_components/city-walk-client";

export const metadata: Metadata = {
  title: "City Walk — Dresden",
  description:
    "Walkable LoD1 city model on DGM terrain with sun/shadow simulation",
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
