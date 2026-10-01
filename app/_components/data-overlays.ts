import type { Object3D } from "three/webgpu";
import type { BikeCounter } from "@/lib/city/bike-counts";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { createBikeFeed, createBikeLayer } from "./bike-layer";

/**
 * The site-wide data layers (lib/city/data-layers.ts) — the ones not cut
 * into tiles: the live bicycle counters. (The traffic bands are per tile,
 * dressing parts in tile-stream.ts.) Each is built on its first switch-on,
 * compiled before it shows, fetched and polled only while it is on, and
 * placed again over the ground as tiles stream in.
 */
export interface DataOverlays {
  /** shows, hides, starts and stops the layers as the look has them */
  apply: (layers: Readonly<Record<DataLayerKey, boolean>>) => void;
  dispose: () => void;
  /** the layers' scene parts, by name (the HUD census) */
  parts: () => { bikes?: Object3D };
  /** the tile set changed: what stands on the ground is placed again;
   *  true when something moved (the shadows need no redraw: no layer
   *  here casts) */
  streamChanged: () => boolean;
}

export function createDataOverlays(opts: {
  /** the site's extent (projected): counters off it are left out */
  bounds: readonly [number, number, number, number];
  /** compiles an object's shaders before it shows (PostStack.compile) */
  compile: (object: Object3D) => Promise<void>;
  epsg: number;
  ground: GroundContext;
  /** the counts as they arrive, for the HUD's list */
  onBikeCounts?: (counters: BikeCounter[]) => void;
  /** something a layer draws changed (the stats follow) */
  onChange?: () => void;
  /** the frame: the overlays hang in the Y-up scene */
  parent: Object3D;
}): DataOverlays {
  let disposed = false;
  let bikesOn = false;
  let bikes: ReturnType<typeof createBikeLayer> | null = null;
  let bikesCompiling = false;
  let bikesCompiled = false;
  const feed = createBikeFeed({
    bounds: opts.bounds,
    epsg: opts.epsg,
    onCounts: (counters) => {
      if (disposed || !bikes) {
        return;
      }
      bikes.set(counters, new Date());
      opts.onBikeCounts?.(counters);
      opts.onChange?.();
      if (!bikesCompiling) {
        bikesCompiling = true;
        const layer = bikes;
        // Shown once its shaders are built, never inside a frame.
        void opts.compile(layer.group).then(() => {
          bikesCompiled = true;
          layer.group.visible = bikesOn && !disposed;
        });
      }
    },
  });
  return {
    apply: (layers) => {
      if (layers.bikeLayer === bikesOn) {
        return;
      }
      bikesOn = layers.bikeLayer;
      if (bikesOn) {
        if (!bikes) {
          bikes = createBikeLayer(opts.ground);
          bikes.group.visible = false;
          opts.parent.add(bikes.group);
        }
        bikes.group.visible = bikesCompiled;
        feed.start();
      } else {
        feed.stop();
        if (bikes) {
          bikes.group.visible = false;
        }
        opts.onBikeCounts?.([]);
      }
    },
    dispose: () => {
      disposed = true;
      feed.stop();
      bikes?.dispose();
      bikes = null;
    },
    parts: () => ({ bikes: bikes?.group }),
    streamChanged: () => (bikesOn && bikes ? bikes.reground() : false),
  };
}
