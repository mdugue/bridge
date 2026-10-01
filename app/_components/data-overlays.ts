import type { Object3D } from "three/webgpu";
import type { BikeCounter } from "@/lib/city/bike-counts";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { BridgeFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import type { TramTimetable } from "@/lib/city/tram-timetable";
import { createBikeFeed, createBikeLayer } from "./bike-layer";
import {
  fetchFeaturesFrom,
  fetchOptionalJson,
  isAbortError,
} from "./fetch-optional";
import { buildDeckTable } from "./rail-layer";
import {
  createTramCars,
  type TramCars,
  type TramCarsStatus,
} from "./tram-cars";

/**
 * The site-wide data layers (lib/city/data-layers.ts) — the ones not cut
 * into tiles: the live bicycle counters and the timetable trams. (The
 * traffic flows are per tile, dressing parts in tile-stream.ts.) Each is
 * built on its first switch-on, compiled before it shows, fetched (and the
 * counters polled) only while it is on, and placed again over the ground
 * as tiles stream in.
 */
export interface DataOverlays {
  /** shows, hides, starts and stops the layers as the look has them */
  apply: (layers: Readonly<Record<DataLayerKey, boolean>>) => void;
  dispose: () => void;
  /** the layers' scene parts, by name (the HUD census) */
  parts: () => { bikes?: Object3D; trams?: Object3D };
  /** the scene's instant changed (the HUD's sun and time): the trams'
   *  clock starts again from it */
  setClock: (date: Date) => void;
  /** a frame: the trams move on (`nowMs` = performance.now()) */
  step: (nowMs: number) => void;
  /** the tile set changed: what stands on the ground is placed again;
   *  true when something moved (the shadows need no redraw: no layer
   *  here casts) */
  streamChanged: () => boolean;
}

/** How often the trams' status goes to the HUD (ms). */
const TRAM_STATUS_MS = 1000;

export interface DataOverlayOptions {
  /** the site's extent (projected): counters off it are left out */
  bounds: readonly [number, number, number, number];
  /** every tile's bridge decks (served URLs): the trams ride them */
  bridgeUrls: string[];
  /** compiles an object's shaders before it shows (PostStack.compile) */
  compile: (object: Object3D) => Promise<void>;
  epsg: number;
  ground: GroundContext;
  /** the scene's instant at boot */
  initialDate: Date;
  /** the counts as they arrive, for the HUD's list */
  onBikeCounts?: (counters: BikeCounter[]) => void;
  /** something a layer draws changed (the stats follow) */
  onChange?: () => void;
  /** the trams' day and count, about once a second while they run; null
   *  when they are switched off */
  onTramStatus?: (status: TramCarsStatus | null) => void;
  /** the frame: the overlays hang in the Y-up scene */
  parent: Object3D;
  /** the timetable (served URL), or undefined where the site has none */
  tramTimetableUrl?: string;
}

/** The live bicycle counters: built on the first switch-on, polled while
 *  on, shown once compiled. */
function bikeOverlay(opts: DataOverlayOptions, alive: () => boolean) {
  let on = false;
  let layer: ReturnType<typeof createBikeLayer> | null = null;
  let compiling = false;
  let compiled = false;
  const feed = createBikeFeed({
    bounds: opts.bounds,
    epsg: opts.epsg,
    onCounts: (counters) => {
      if (!(alive() && layer)) {
        return;
      }
      layer.set(counters, new Date());
      opts.onBikeCounts?.(counters);
      opts.onChange?.();
      if (!compiling) {
        compiling = true;
        const built = layer;
        // Shown once its shaders are built, never inside a frame.
        void opts.compile(built.group).then(() => {
          compiled = true;
          built.group.visible = on && alive();
        });
      }
    },
  });
  return {
    apply: (next: boolean) => {
      if (next === on) {
        return;
      }
      on = next;
      if (on) {
        if (!layer) {
          layer = createBikeLayer(opts.ground);
          layer.group.visible = false;
          opts.parent.add(layer.group);
        }
        layer.group.visible = compiled;
        feed.start();
      } else {
        feed.stop();
        if (layer) {
          layer.group.visible = false;
        }
        opts.onBikeCounts?.([]);
      }
    },
    dispose: () => {
      feed.stop();
      layer?.dispose();
      layer = null;
    },
    group: () => layer?.group,
    reground: () => (on && layer ? layer.reground() : false),
  };
}

/** The timetable trams: loaded (timetable and bridge decks) on the first
 *  switch-on, run from the scene's clock. */
function tramOverlay(
  opts: DataOverlayOptions,
  alive: () => boolean,
  signal: AbortSignal
) {
  let on = false;
  let cars: TramCars | null = null;
  let loading = false;
  let clockBase = opts.initialDate.getTime();
  let clockSetAt = performance.now();
  let statusDue = 0;
  const clock = (nowMs: number) => new Date(clockBase + (nowMs - clockSetAt));
  const load = async () => {
    const url = opts.tramTimetableUrl;
    if (!url || loading) {
      return;
    }
    loading = true;
    try {
      const [timetable, bridges] = await Promise.all([
        fetchOptionalJson<TramTimetable>(url, signal),
        fetchFeaturesFrom<BridgeFeature>(opts.bridgeUrls, signal),
      ]);
      if (!(timetable && alive())) {
        return;
      }
      // Decks only: the approach ramps need the ground of tiles that may
      // not have streamed in; a car off the deck rides the ground.
      const decks = buildDeckTable(bridges, { offset: opts.ground.offset });
      const built = createTramCars(timetable, decks, opts.ground);
      built.group.visible = false;
      opts.parent.add(built.group);
      built.update(clock(performance.now()));
      await opts.compile(built.group);
      if (!alive()) {
        built.dispose();
        return;
      }
      cars = built;
      built.group.visible = on;
      opts.onChange?.();
    } catch (err) {
      if (!isAbortError(err)) {
        throw err;
      }
    }
  };
  return {
    apply: (next: boolean) => {
      if (next === on) {
        return;
      }
      on = next;
      statusDue = 0;
      if (cars) {
        cars.group.visible = on;
      } else if (on) {
        void load();
      }
      if (!on) {
        opts.onTramStatus?.(null);
      }
    },
    dispose: () => {
      cars?.dispose();
      cars = null;
    },
    group: () => cars?.group,
    setClock: (date: Date) => {
      clockBase = date.getTime();
      clockSetAt = performance.now();
      statusDue = 0;
    },
    step: (nowMs: number) => {
      if (!(on && cars)) {
        return;
      }
      const status = cars.update(clock(nowMs));
      if (nowMs >= statusDue) {
        statusDue = nowMs + TRAM_STATUS_MS;
        opts.onTramStatus?.(status);
      }
    },
  };
}

export function createDataOverlays(opts: DataOverlayOptions): DataOverlays {
  let disposed = false;
  const alive = () => !disposed;
  const aborter = new AbortController();
  const bikes = bikeOverlay(opts, alive);
  const trams = tramOverlay(opts, alive, aborter.signal);
  return {
    apply: (layers) => {
      bikes.apply(layers.bikeLayer);
      trams.apply(layers.tramLayer);
    },
    dispose: () => {
      disposed = true;
      aborter.abort();
      bikes.dispose();
      trams.dispose();
    },
    parts: () => ({ bikes: bikes.group(), trams: trams.group() }),
    setClock: trams.setClock,
    step: trams.step,
    streamChanged: bikes.reground,
  };
}
