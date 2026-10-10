import type { Object3D } from "three/webgpu";
import type { AskSet } from "@/lib/city/ask-solids";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import type { TrafficHourStatus } from "@/lib/city/traffic-hours";
import { createDataOverlays, type DataOverlayOptions } from "./data-overlays";
import type { SpineHooks } from "./feature-seam";
import { setDataTime } from "./glass";
import { trafficAskSet } from "./traffic-ask";
import { buildTraffic } from "./traffic-layer";

/**
 * The data layers (lib/city/data-layers.ts, ADR 0040) as a feature of the
 * seam (feature-seam.ts, plan 074 part B): started by create-app.ts on the
 * first switch-on of any layer, then driven by the spine's hooks rather
 * than wired into it. Everything the layers draw starts here: the
 * site-wide overlays (data-overlays.ts: the bicycle columns, the timetable
 * trams, the traffic's hour), the per-tile traffic bodies (traffic-layer.ts,
 * built by tile-stream.ts's slot through `traffic`), their glass (glass.ts)
 * and the questions they answer. What the scene needs of the flows before
 * that (the outline's position node, the hour's uniforms) is
 * traffic-flow.ts. Its code ships with the scene's (feature-seam.ts says
 * why).
 */

/** What a tile's traffic slot builds its bodies with
 *  (tile-stream.ts `trafficSlot`). */
export interface TrafficBuilder {
  build: typeof buildTraffic;
  askSet: typeof trafficAskSet;
}

/** The started data layers, as the spine sees them. */
export interface DataLayers {
  /** what the probe can ask on the shown site-wide layers */
  asks: () => AskSet<FeatureInquiry>[];
  dispose: () => void;
  /** the layers' scene parts, by name (the HUD census) */
  parts: () => { bikes?: Object3D; trams?: Object3D };
  /** the per-tile traffic bodies' builder */
  traffic: TrafficBuilder;
  /** the traffic's hour at the scene's instant now (a card's estimate) */
  trafficHour: () => TrafficHourStatus;
}

/**
 * Starts the data layers against the spine's hooks: the look shows and
 * hides them (read now, then heard), the frame moves their light, the
 * trams and the hour on, the stream places what stands on the ground
 * again, the scene's clock runs theirs.
 */
export function startDataLayers(
  hooks: SpineHooks,
  opts: Omit<DataOverlayOptions, "initialAtMs" | "initialDate">
): DataLayers {
  const clock = hooks.clock.get();
  const overlays = createDataOverlays({
    ...opts,
    initialDate: clock.date,
    initialAtMs: clock.atMs,
  });
  overlays.apply(hooks.look.get());
  const off = [
    hooks.look.subscribe((look) => overlays.apply(look)),
    hooks.clock.subscribe((now) => overlays.setClock(now.date)),
    hooks.frame.on((elapsed, nowMs) => {
      // the glass's light (one shared uniform; drawn only while on)
      setDataTime(elapsed);
      overlays.step(nowMs);
    }),
    hooks.streamChange.on(() => {
      overlays.streamChanged();
    }),
  ];
  return {
    asks: overlays.asks,
    dispose: () => {
      for (const stop of off) {
        stop();
      }
      overlays.dispose();
    },
    parts: overlays.parts,
    traffic: { build: buildTraffic, askSet: trafficAskSet },
    trafficHour: overlays.trafficHour,
  };
}
