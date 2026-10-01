import type { Object3D } from "three/webgpu";
import type { AskSet } from "@/lib/city/ask-solids";
import type { BikeCounter } from "@/lib/city/bike-counts";
import {
  BIKE_FEED_READERS,
  type BikeFeedId,
  type BikeFeedReader,
} from "@/lib/city/bike-feeds";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { BridgeFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import {
  type TrafficHourStatus,
  trafficFactor,
  trafficHourStatus,
  trafficSpeed,
} from "@/lib/city/traffic-hours";
import type { TramTimetable } from "@/lib/city/tram-timetable";
import { bikeAskSets } from "./bike-ask";
import { createBikeFeed, createBikeLayer } from "./bike-layer";
import {
  fetchFeaturesFrom,
  fetchOptionalJson,
  isAbortError,
} from "./fetch-optional";
import { buildDeckTable } from "./rail-layer";
import { setTrafficClock } from "./traffic-layer";
import {
  createTramCars,
  type TramCars,
  type TramCarsStatus,
} from "./tram-cars";

/**
 * The site-wide data layers (lib/city/data-layers.ts) — the ones not cut
 * into tiles: the live bicycle counters and the timetable trams, and the
 * traffic's hour. (The traffic flows themselves are per tile, dressing
 * parts in tile-stream.ts; their hour is one pair of shared uniforms.) Each is
 * built on its first switch-on, compiled before it shows, fetched (and the
 * counters polled) only while it is on, and placed again over the ground
 * as tiles stream in.
 */
export interface DataOverlays {
  /** shows, hides, starts and stops the layers as the look has them */
  apply: (layers: Readonly<Record<DataLayerKey, boolean>>) => void;
  /** what the probe can ask on the shown layers: the bicycle counters'
   *  columns (bike-ask.ts; the traffic's sections are the tiles') */
  asks: () => AskSet<FeatureInquiry>[];
  dispose: () => void;
  /** the layers' scene parts, by name (the HUD census) */
  parts: () => { bikes?: Object3D; trams?: Object3D };
  /** the scene's instant changed (the HUD's sun and time): the trams'
   *  and the traffic's clock starts again from it */
  setClock: (date: Date) => void;
  /** a frame: the trams move on, the traffic keeps the hour
   *  (`nowMs` = performance.now()) */
  step: (nowMs: number) => void;
  /** the traffic's hour at the scene's instant now (a card's estimate) */
  trafficHour: () => TrafficHourStatus;
  /** the tile set changed: what stands on the ground is placed again;
   *  true when something moved (the shadows need no redraw: no layer
   *  here casts) */
  streamChanged: () => boolean;
}

/** How often the trams' status and the traffic's hour go to the HUD (ms). */
const TRAM_STATUS_MS = 1000;

export interface DataOverlayOptions {
  /** the site's live bicycle-counter feed, or undefined where it has none */
  bikeFeed?: BikeFeedId;
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
  /** the traffic's hour, about once a second while its layer is on; null
   *  when it is switched off */
  onTrafficHour?: (status: TrafficHourStatus | null) => void;
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
function bikeOverlay(
  opts: DataOverlayOptions,
  alive: () => boolean,
  reader: BikeFeedReader
) {
  let on = false;
  let layer: ReturnType<typeof createBikeLayer> | null = null;
  let compiling = false;
  let compiled = false;
  const feed = createBikeFeed({
    bounds: opts.bounds,
    epsg: opts.epsg,
    feed: reader,
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
    asks: () =>
      on && layer?.group.visible
        ? bikeAskSets(layer.counters(), opts.ground, new Date())
        : [],
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
  signal: AbortSignal,
  clock: (nowMs: number) => Date
) {
  let on = false;
  let cars: TramCars | null = null;
  let loading = false;
  let statusDue = 0;
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
    clockChanged: () => {
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

/** The traffic flows' hour (the flows themselves are per tile): how busy
 *  the scene's instant is and how far their light has run, written to the
 *  flows' shared uniforms every frame; the HUD hears it about once a
 *  second while the layer is on. */
function trafficClock(
  opts: DataOverlayOptions,
  clock: (nowMs: number) => Date
) {
  let on = false;
  let travel = 0;
  let lastMs: number | null = null;
  let statusDue = 0;
  return {
    apply: (next: boolean) => {
      if (next === on) {
        return;
      }
      on = next;
      statusDue = 0;
      if (!on) {
        opts.onTrafficHour?.(null);
      }
    },
    clockChanged: () => {
      statusDue = 0;
    },
    step: (nowMs: number) => {
      if (!on) {
        lastMs = null;
        return;
      }
      const date = clock(nowMs);
      const factor = trafficFactor(date);
      // a frame's step, capped: a tab in the background comes back calm
      const dt = lastMs === null ? 0 : Math.min((nowMs - lastMs) / 1000, 0.1);
      lastMs = nowMs;
      travel += dt * trafficSpeed(factor);
      setTrafficClock(factor, travel);
      if (nowMs >= statusDue) {
        statusDue = nowMs + TRAM_STATUS_MS;
        opts.onTrafficHour?.(trafficHourStatus(date));
      }
    },
  };
}

export function createDataOverlays(opts: DataOverlayOptions): DataOverlays {
  let disposed = false;
  const alive = () => !disposed;
  const aborter = new AbortController();
  // The scene's clock: set by the HUD's sun and time, running on in real
  // time from there — the trams and the traffic's hour both read it.
  let clockBase = opts.initialDate.getTime();
  let clockSetAt = performance.now();
  const clock = (nowMs: number) => new Date(clockBase + (nowMs - clockSetAt));
  // A site without a feed has no bicycle layer: its switch is not shown,
  // and a snapshot that turns it on finds nothing to start.
  const bikes = opts.bikeFeed
    ? bikeOverlay(opts, alive, BIKE_FEED_READERS[opts.bikeFeed])
    : null;
  const trams = tramOverlay(opts, alive, aborter.signal, clock);
  const traffic = trafficClock(opts, clock);
  return {
    apply: (layers) => {
      bikes?.apply(layers.bikeLayer);
      trams.apply(layers.tramLayer);
      traffic.apply(layers.trafficLayer);
    },
    asks: () => bikes?.asks() ?? [],
    dispose: () => {
      disposed = true;
      aborter.abort();
      bikes?.dispose();
      trams.dispose();
    },
    parts: () => ({ bikes: bikes?.group(), trams: trams.group() }),
    setClock: (date: Date) => {
      clockBase = date.getTime();
      clockSetAt = performance.now();
      trams.clockChanged();
      traffic.clockChanged();
    },
    step: (nowMs: number) => {
      trams.step(nowMs);
      traffic.step(nowMs);
    },
    streamChanged: () => bikes?.reground() ?? false,
    trafficHour: () => trafficHourStatus(clock(performance.now())),
  };
}
