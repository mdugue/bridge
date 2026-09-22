"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { loadStageStates } from "@/lib/city/load-stages";
import {
  type DataManifest,
  MANIFEST_FILE,
  TILE_BLOCK,
  tileUrlsFrom,
} from "@/lib/city/tile";
import { LoadScreen } from "./load-screen";
import { currentSceneBudget, type SceneBudget } from "./scene-profile";

/**
 * The same Laden screen the viewer shows, at zero — the manifest fetch and
 * the viewer chunk are the first seconds of the load, and on a phone they are
 * seconds you can see. Rendering anything else here (it used to be a slab of
 * slate with "Loading 3D viewer…") means the redesign starts by replacing a
 * different loading screen.
 *
 * It is a plain render, not a transition, so the shared names stay dormant and
 * the handover still belongs to the viewer's own screen.
 */
function BootScreen() {
  return (
    <div className="relative h-full w-full">
      <LoadScreen percent={0} stages={loadStageStates({})} />
    </div>
  );
}

// three.js needs a real browser (WebGL, pointer lock) — never prerender it.
// `ssr: false` is only allowed inside a Client Component, hence this wrapper.
const CityWalk = dynamic(() => import("./city-walk"), {
  ssr: false,
  loading: () => <BootScreen />,
});

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
    void fetch(`/data/${MANIFEST_FILE}`, { cache: "no-cache" })
      .then((res) => (res.ok ? (res.json() as Promise<DataManifest>) : null))
      .catch(() => null)
      .then((m) => {
        if (!cancelled) {
          setManifest(m?.version === 1 ? m : null);
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
  const tiles = useMemo(() => {
    if (manifest === undefined) {
      return null;
    }
    // The render budget (profile, device tier, neighbour tiles) is read from
    // the page ONCE, here, and handed down: the primary and its neighbours
    // agree on the tier, and the scene never re-reads the window.
    const budget: SceneBudget = currentSceneBudget();
    return {
      budget,
      primary: tileUrlsFrom(PRIMARY_SPEC, manifest, budget.lowRasters),
      extra: NEIGHBOUR_SPECS.map((spec) =>
        tileUrlsFrom(spec, manifest, budget.lowRasters)
      ),
    };
  }, [manifest]);
  if (!tiles) {
    return <BootScreen />;
  }
  return (
    <CityWalk
      budget={tiles.budget}
      extraTiles={tiles.extra}
      primary={tiles.primary}
    />
  );
}
