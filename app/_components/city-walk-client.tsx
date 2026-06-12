"use client";

import dynamic from "next/dynamic";

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

// Tile prepared by scripts/prepare-data.ts (copied from data/ to public/data).
const TILE = "33412_5656_2_sn";

export function CityWalkClient() {
  return (
    <CityWalk
      citySrc={`/data/lod2_${TILE}.city.json`}
      demSrc={`/data/dgm1_${TILE}.tif`}
      demTfwSrc={`/data/dgm1_${TILE}.tfw`}
    />
  );
}
