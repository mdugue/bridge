"use client";

import dynamic from "next/dynamic";
import { TILE_BLOCK, type TileSpec, tileUrls } from "@/lib/city/tile";
import type { TileSrc } from "./create-app";

// three.js needs a real browser (WebGL, pointer lock) — never prerender it.
// `ssr: false` is only allowed inside a Client Component, hence this wrapper.
const CityWalk = dynamic(() => import("./city-walk"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-900 text-lg text-white">
      Loading 3D viewer…
    </div>
  ),
});

/** Builds the per-tile URLs (all prepared by scripts/prepare-data.ts). */
function tile(spec: TileSpec): TileSrc {
  const u = tileUrls(spec);
  return {
    citySrc: u.city,
    roofColorSrc: u.roofColor,
    demSrc: u.heightfieldHeader,
    landcoverSrc: u.landcover,
    landcoverRgbSrc: u.landcoverRgb,
    ndviSrc: u.ndvi,
    vegetationSrc: u.vegrows,
    canopySrc: u.canopy,
    // Optional (OSM, ODbL); the loaders treat a 404 as "feature off".
    lampsSrc: u.lamps,
    wallsSrc: u.walls,
    // Railway tracks + bridge decks + ballast yards (Basis-DLM); platforms (OSM).
    railSrc: u.rail,
    bridgeSrc: u.bridge,
    railareaSrc: u.railarea,
    platformSrc: u.platform,
  };
}

// Primary tile (spawn here) + the rest of the 2 x 2 block around it, in the
// order lib/city/tile.ts lists them (the same list prepare-data.ts bakes).
// Module constants so the references stay stable across renders.
const [PRIMARY_SPEC, ...NEIGHBOUR_SPECS] = TILE_BLOCK;
const PRIMARY = tile(PRIMARY_SPEC);
const EXTRA_TILES: TileSrc[] = NEIGHBOUR_SPECS.map(tile);

export function CityWalkClient() {
  return <CityWalk extraTiles={EXTRA_TILES} primary={PRIMARY} />;
}
