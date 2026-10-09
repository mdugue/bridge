"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isNetworkFailure,
  MANIFEST_FETCH_BUDGET_MS,
} from "@/lib/city/fetch-retry";
import type { SafetyLevel } from "@/lib/city/gpu-safety";
import { loadStageStates } from "@/lib/city/load-stages";
import { siteDataBase } from "@/lib/city/site-index";
import { type DataManifest, MANIFEST_FILE, manifestUrl } from "@/lib/city/tile";
import { TILESET_FILE, TILESET_SPAWN_FILE } from "@/lib/city/tileset";
import { BootError } from "./boot-error";
import { type FetchedBytes, fetchBytes, isAbortError } from "./fetch-optional";
import { pageSafety } from "./gpu-safety";
import { LoadScreen } from "./load-screen";
import { currentSceneBudget } from "./scene-profile";
import { SiteProvider } from "./site-context";
import { siteById } from "@/sites";

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
// (The import stays written out inside dynamic(): Next matches the call to
// its chunk by it.)
const CityWalk = dynamic(() => import("./city-walk"), {
  ssr: false,
  loading: () => <BootScreen />,
});

/**
 * The viewer's two chunks — the HUD (city-walk.tsx) and the scene with
 * three.js (create-app.ts, which the HUD imports only when it boots) — do
 * not depend on the manifest: SiteViewer starts all three at once. The same
 * modules, so the same chunks. Called from an effect, never at module
 * scope: this module renders on the server too, and three must not load
 * there.
 */
const loadViewer = () =>
  Promise.all([import("./city-walk"), import("./create-app")]);

/**
 * The artifact manifest (logical → content-hashed file names, see
 * lib/city/tile.ts). Fetched with `no-cache` so a re-bake reaches every client
 * while the hashed files themselves stay cached forever — the tileset it
 * names references everything else by hashed name. A network failure is
 * retried (fetch-optional.ts `fetchBytes`); once that gives up, the copy
 * this browser cached last will do (its hashed files are likely cached
 * too). Without either there is nothing to start from — the unhashed names
 * are never published (scripts/prepare-data.ts prunes them) — so the boot
 * error says so, with a way to try again.
 */
async function loadManifest(
  url: string,
  signal: AbortSignal
): Promise<DataManifest> {
  let got: FetchedBytes;
  try {
    got = await fetchBytes(url, {
      signal,
      budgetMs: MANIFEST_FETCH_BUDGET_MS,
      init: { cache: "no-cache" },
    });
  } catch (err) {
    if (!isNetworkFailure(err)) {
      throw err;
    }
    got = await fetchBytes(url, {
      signal,
      budgetMs: 0,
      init: { cache: "force-cache" },
    }).catch(() => {
      throw err;
    });
  }
  if (!got.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${got.status}`);
  }
  const manifest = JSON.parse(new TextDecoder().decode(got.bytes)) as
    | Partial<DataManifest>
    | undefined;
  if (manifest?.version !== 1) {
    throw new Error(`${url}: not a version 1 manifest`);
  }
  return manifest as DataManifest;
}

function useDataManifest(base: string): {
  manifest?: DataManifest;
  /** why there is none (the boot error's message) */
  failed?: string;
  retry: () => void;
} {
  const [state, setState] = useState<{
    manifest?: DataManifest;
    failed?: string;
  }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const aborter = new AbortController();
    loadManifest(`${base}/${MANIFEST_FILE}`, aborter.signal).then(
      (manifest) => {
        if (!aborter.signal.aborted) {
          setState({ manifest });
        }
      },
      (err: unknown) => {
        if (!(aborter.signal.aborted || isAbortError(err))) {
          setState({
            failed: err instanceof Error ? err.message : String(err),
          });
        }
      }
    );
    return () => aborter.abort();
  }, [base, attempt]);
  const retry = useCallback(() => {
    setState({});
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

/**
 * The device's safety level (gpu-safety.ts), null until it has settled:
 * it reads the previous page's crash trail before this page's own trail
 * starts (city-walk.tsx mounts only once the budget is made), and a
 * previous record that looks crashed is first asked whether its page is
 * still open — beside the manifest's fetch, so the boot waits on both.
 */
function usePageSafety(): SafetyLevel | null {
  const [safety, setSafety] = useState<SafetyLevel | null>(null);
  useEffect(() => {
    let live = true;
    void pageSafety().then((level) => {
      if (live) {
        setSafety(level);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return safety;
}

/**
 * The viewer for one site (the route /<site>): its data folder, and the
 * site itself for every part of the HUD (site-context.tsx). Takes the id, not
 * the Site, since a Server Component renders it; the registry resolves it.
 */
export function CityWalkClient({
  builtIds = [],
  siteId,
}: {
  /** every site this deployment serves (the route's own included) */
  builtIds?: readonly string[];
  siteId: string;
}) {
  const site = siteById(siteId);
  const others = builtIds
    .filter((id) => id !== siteId)
    .map((id) => siteById(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  if (!site) {
    throw new Error(`unknown site "${siteId}"`);
  }
  return (
    <SiteProvider others={others} site={site}>
      <SiteViewer base={siteDataBase(site.id)} />
    </SiteProvider>
  );
}

function SiteViewer({ base }: { base: string }) {
  useEffect(() => {
    // A failed chunk load is next/dynamic's to report when it renders; this
    // early start must not add an unhandled rejection of its own.
    loadViewer().catch(() => undefined);
  }, []);
  const { manifest, failed, retry } = useDataManifest(base);
  const safety = usePageSafety();
  // The render budget (profile, device tier, whether the rest of the site
  // streams, the device's safety level) is read from the page ONCE, here,
  // and handed down; the scene never re-reads the window. The lite profile
  // streams the spawn tile alone.
  // The HUD mounts as soon as the budget is made; the scene inside it waits
  // for the manifest that names its tileset. The panel is usable meanwhile.
  const budget = useMemo(
    () => (safety === null ? null : currentSceneBudget(safety)),
    [safety]
  );
  const tilesetUrl = useMemo(() => {
    if (manifest === undefined || budget === null) {
      return null;
    }
    const tileset = budget.neighbourTiles ? TILESET_FILE : TILESET_SPAWN_FILE;
    return manifestUrl(manifest, tileset, base);
  }, [base, budget, manifest]);
  if (!budget) {
    return failed === undefined ? (
      <BootScreen />
    ) : (
      <div className="relative h-full w-full bg-[image:var(--hud-scrim)]">
        <BootError message={failed} onRetry={retry} />
      </div>
    );
  }
  return (
    <CityWalk
      budget={budget}
      manifestError={
        failed === undefined ? undefined : { message: failed, retry }
      }
      tilesetUrl={tilesetUrl}
    />
  );
}
