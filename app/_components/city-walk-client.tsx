"use client";

import dynamic from "next/dynamic";
import { TILE_NAMES } from "@/lib/city/tiles";
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
function tile(name: string): TileSrc {
  return {
    citySrc: `/data/lod2_${name}.city.json`,
    demSrc: `/data/dgm1_${name}.tif`,
    demTfwSrc: `/data/dgm1_${name}.tfw`,
    landcoverSrc: `/data/landcover_${name}.png`,
    vegetationSrc: `/data/vegrows_${name}.geojson`,
  };
}

// Primary tile (spawn here) + the rest of the 2 x 2 block around it, from the
// shared tile list. Module constants so references stay stable across renders.
const [PRIMARY_NAME, ...EXTRA_NAMES] = TILE_NAMES;
const PRIMARY = tile(PRIMARY_NAME);
const EXTRA_TILES: TileSrc[] = EXTRA_NAMES.map(tile);

export function CityWalkClient() {
  return (
    <CityWalk
      citySrc={PRIMARY.citySrc}
      demSrc={PRIMARY.demSrc}
      demTfwSrc={PRIMARY.demTfwSrc}
      extraTiles={EXTRA_TILES}
      landcoverSrc={PRIMARY.landcoverSrc}
      vegetationSrc={PRIMARY.vegetationSrc}
    />
  );
}
