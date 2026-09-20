"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  type DataManifest,
  MANIFEST_FILE,
  TILE_BLOCK,
  type TileSpec,
  tileUrlsFrom,
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
function tile(spec: TileSpec, manifest: DataManifest | null): TileSrc {
  const u = tileUrlsFrom(spec, manifest);
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

const [PRIMARY_SPEC, ...NEIGHBOUR_SPECS] = TILE_BLOCK;

/**
 * The artifact manifest (logical → content-hashed file names, see
 * lib/city/tile.ts). Fetched with `no-cache` so a re-bake reaches every client
 * while the hashed files themselves stay cached forever. A missing manifest
 * (an old deploy, a hand-copied public/data) falls back to the flat names.
 */
function useDataManifest(): DataManifest | null | undefined {
  const [manifest, setManifest] = useState<DataManifest | null | undefined>();
  useEffect(() => {
    let cancelled = false;
    fetch(`/data/${MANIFEST_FILE}`, { cache: "no-cache" })
      .then((res) => (res.ok ? (res.json() as Promise<DataManifest>) : null))
      .catch(() => null)
      .then((m) => {
        if (!cancelled) {
          setManifest(m && m.version === 1 ? m : null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return manifest;
}

export function CityWalkClient() {
  const manifest = useDataManifest();
  // Primary tile (spawn here) + the rest of the 2 x 2 block around it, in the
  // order lib/city/tile.ts lists them (the same list prepare-data.ts bakes).
  // Memoised so the references stay stable across renders (the HUD effect
  // keys on them).
  const tiles = useMemo(
    () =>
      manifest === undefined
        ? null
        : {
            primary: tile(PRIMARY_SPEC, manifest),
            extra: NEIGHBOUR_SPECS.map((spec) => tile(spec, manifest)),
          },
    [manifest]
  );
  if (!tiles) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-900 text-lg text-white">
        Loading 3D viewer…
      </div>
    );
  }
  return <CityWalk extraTiles={tiles.extra} primary={tiles.primary} />;
}
