"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { loadStageStates } from "@/lib/city/load-stages";
import { type DataManifest, MANIFEST_FILE, manifestUrl } from "@/lib/city/tile";
import { TILESET_FILE, TILESET_SPAWN_FILE } from "@/lib/city/tileset";
import { LoadScreen } from "./load-screen";
import { currentSceneBudget, type SceneBudget } from "./scene-profile";

/**
 * The same Laden screen the viewer shows, at zero — the manifest fetch and
 * the viewer chunk are the first seconds of the load, and on a phone they are
 * seconds you can see. Rendering anything else here (it used to be a slab of
 * slate with "Loading 3D viewer…") means the redesign starts by replacing a
 * different loading screen.
 *
 * The screen itself is translucent — it frosts whatever the viewer renders
 * behind it (see handover.ts) — and there is no canvas yet, so it gets the
 * opaque scrim the viewer's own shell would otherwise provide.
 */
function BootScreen() {
  return (
    <div className="relative h-full w-full bg-[image:var(--hud-scrim)]">
      <LoadScreen handedOver={false} percent={0} stages={loadStageStates({})} />
    </div>
  );
}

// three.js needs a real browser (WebGPU or WebGL2, pointer lock) — never
// prerender it.
// `ssr: false` is only allowed inside a Client Component, hence this wrapper.
const CityWalk = dynamic(() => import("./city-walk"), {
  ssr: false,
  loading: () => <BootScreen />,
});

/**
 * The artifact manifest (logical → content-hashed file names, see
 * lib/city/tile.ts). Fetched with `no-cache` so a re-bake reaches every client
 * while the hashed files themselves stay cached forever — the tileset it
 * names references everything else by hashed name.
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
  // The render budget (profile, device tier, whether the rest of the site
  // streams) is read from the page ONCE, here, and handed down; the scene
  // never re-reads the window. The lite profile streams the spawn tile alone.
  const setup = useMemo(() => {
    if (manifest === undefined) {
      return null;
    }
    const budget: SceneBudget = currentSceneBudget();
    const tileset = budget.neighbourTiles ? TILESET_FILE : TILESET_SPAWN_FILE;
    return { budget, tilesetUrl: manifestUrl(manifest, tileset) };
  }, [manifest]);
  if (!setup) {
    return <BootScreen />;
  }
  return <CityWalk budget={setup.budget} tilesetUrl={setup.tilesetUrl} />;
}
