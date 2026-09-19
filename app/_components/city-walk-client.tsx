"use client";

import dynamic from "next/dynamic";
import {
  cityJsonFile,
  heightfieldHeaderFile,
  TILE_BLOCK,
  type TileSpec,
} from "@/lib/city/tile";
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
function tile({ tile: name, n }: TileSpec): TileSrc {
  return {
    citySrc: `/data/${cityJsonFile(name)}`,
    demSrc: `/data/${heightfieldHeaderFile(name, n)}`,
    landcoverSrc: `/data/landcover_${name}.png`,
    vegetationSrc: `/data/vegrows_${name}.geojson`,
    // Optional (OSM, ODbL); the loader treats a 404 as "no lamps".
    lampsSrc: `/data/lamps_${name}.geojson`,
    // Railway tracks + bridge decks + ballast yards (Basis-DLM); platforms (OSM).
    railSrc: `/data/rail_${name}.geojson`,
    bridgeSrc: `/data/bridge_${name}.geojson`,
    railareaSrc: `/data/railarea_${name}.geojson`,
    platformSrc: `/data/platform_${name}.geojson`,
  };
}

// Primary tile (spawn here) + the rest of the 2 x 2 block around it, in the
// order lib/city/tile.ts lists them (the same list prepare-data.ts bakes).
// Module constants so the references stay stable across renders.
const [PRIMARY_SPEC, ...NEIGHBOUR_SPECS] = TILE_BLOCK;
const PRIMARY = tile(PRIMARY_SPEC);
const EXTRA_TILES: TileSrc[] = NEIGHBOUR_SPECS.map(tile);

export function CityWalkClient() {
  return (
    <CityWalk
      bridgeSrc={PRIMARY.bridgeSrc}
      citySrc={PRIMARY.citySrc}
      demSrc={PRIMARY.demSrc}
      extraTiles={EXTRA_TILES}
      lampsSrc={PRIMARY.lampsSrc}
      landcoverSrc={PRIMARY.landcoverSrc}
      platformSrc={PRIMARY.platformSrc}
      railareaSrc={PRIMARY.railareaSrc}
      railSrc={PRIMARY.railSrc}
      vegetationSrc={PRIMARY.vegetationSrc}
    />
  );
}
