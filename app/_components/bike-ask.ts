import { type AskItem, type AskSet, askSets } from "@/lib/city/ask-solids";
import { BIKE_STALE_MS, type BikeCounter } from "@/lib/city/bike-counts";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import { BIKE_FOOT_SINK_M, bikeColumns } from "./bike-layer";

/** A column is picked a little wider than it is drawn (m). */
const PICK_MARGIN = 0.25;

/**
 * The live bicycle counters as askable things (ADR 0041, the data layer
 * of ADR 0040): each counter's columns as drawn (`bikeColumns`), standing
 * on the ground under them; a counter whose ground has not streamed in is
 * not askable yet. Rebuilt from the counts the layer shows, so a ray
 * meets the columns as tall as they stand now.
 */
export function bikeAskSets(
  counters: readonly BikeCounter[],
  ground: Pick<GroundContext, "heightAt" | "offset">,
  now: Date
): AskSet<FeatureInquiry>[] {
  const items: AskItem<FeatureInquiry>[] = [];
  for (const c of counters) {
    const base = ground.heightAt(c.x, c.y);
    if (base === null) {
      continue;
    }
    const solids = bikeColumns(c).map((column) => {
      const w = epsgToWorld(column.x, column.y, ground.offset);
      const y0 = base - BIKE_FOOT_SINK_M;
      return {
        cylinder: {
          x: w.x,
          z: w.z,
          y0,
          y1: y0 + column.height,
          r: column.radius + PICK_MARGIN,
        },
      };
    });
    if (solids.length === 0) {
      continue;
    }
    items.push({
      solids,
      target: {
        kind: "bikes",
        id: c.id,
        name: c.name,
        where: c.where,
        directions: c.directions,
        measuredAt: c.measuredAt,
        now,
        position: [c.x, c.y],
        staleAfterMs: BIKE_STALE_MS,
      },
    });
  }
  return askSets(items);
}
