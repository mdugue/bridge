import {
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { materialColor, positionLocal, vec3 } from "three/tsl";
import {
  acrossStreet,
  type BikeCounter,
  BIKE_DIRECTION_TINTS,
  BIKE_STALE_TINT,
  BIKE_POLL_MS,
  bikeColumnHeight,
  bikeCountsUrl,
  isStale,
  parseBikeCounts,
} from "@/lib/city/bike-counts";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { fetchOptionalJson, isAbortError } from "./fetch-optional";
import { Instances, instancePosition, instanceTint } from "./instancing";
import { mapWidenNode } from "./map-overlay";
import { sceneMaterial } from "./three-utils";

/**
 * The city's permanent bicycle counters, live (lib/city/bike-counts.ts;
 * Landeshauptstadt Dresden, dl-de/by-2-0) — a data layer
 * (lib/city/data-layers.ts), hidden unless the HUD switches it on, and
 * fetched only then.
 *
 * Per counter a pair of slim columns either side of the street, one per
 * direction (teal the first, lilac the second, as the HUD's list names
 * them), each as tall as the root of its bicycles in the last counted hour
 * (`bikeColumnHeight`); a counter whose count is older than three hours
 * stands grey. From the air the columns widen with the bands
 * (`mapWidenNode`). They stand on the ground under the counter — feet a
 * row under it (ADR 0035's 0.2 m of a box), so a slope beside it buries
 * the downhill side's foot rather than leaving it in the air — and are
 * placed again as the ground streams in: a counter over ground not loaded
 * yet waits. No shadow: a data mark, not a body. Site-wide, not per tile:
 * one set for the 35 counters, owned by create-app.ts.
 */

/** The column's radius (m) on foot. */
const COLUMN_RADIUS = 0.6;
/** Half the distance between a counter's two columns (m). */
const PAIR_HALF_M = 1.0;
/** How far the foot goes under the ground (m; ADR 0035's box row). */
const FOOT_SINK_M = 0.2;
/** The most counters the set holds (the city runs 35). */
const CAPACITY = 128;

function columnMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("bike-column", () => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.6 });
    const widen = mapWidenNode();
    m.positionNode = instancePosition(
      vec3(
        positionLocal.x.mul(widen),
        positionLocal.y,
        positionLocal.z.mul(widen)
      )
    );
    m.colorNode = materialColor.mul(instanceTint());
    // A faint glow of its own, so a column reads at dusk too.
    m.emissiveNode = instanceTint().mul(0.18);
    return m;
  });
}

export interface BikeLayer {
  group: Group;
  /** the counters shown now */
  counters: () => BikeCounter[];
  dispose: () => void;
  /** places the columns again over the ground as it is now (call when the
   *  stream changed); true when a column moved */
  reground: () => boolean;
  /** new counts (and the instant they are judged stale against) */
  set: (counters: BikeCounter[], now: Date) => void;
}

export function createBikeLayer(ctx: GroundContext): BikeLayer {
  const group = new Group();
  group.name = "bike-counters";
  // A unit column standing on its foot (y 0..1), scaled per instance.
  const unit = new CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS, 1, 12);
  unit.translate(0, 0.5, 0);
  const columns = new Instances(unit, columnMaterial(), CAPACITY);
  columns.name = "bike-columns";
  columns.castShadow = false;
  columns.receiveShadow = false;
  columns.drawCount = 0;
  group.add(columns);
  let shown: BikeCounter[] = [];
  let now = new Date();
  let placed = "";
  const m = new Matrix4();
  const tint = new Color();

  const place = (): boolean => {
    let n = 0;
    const key: string[] = [];
    for (const c of shown) {
      const ground = ctx.heightAt(c.x, c.y);
      if (ground === null) {
        continue; // its ground has not streamed in yet
      }
      const stale = isStale(c, now);
      const [ax, ay] = acrossStreet(c.angleDeg);
      c.directions.forEach((d, i) => {
        if (n >= CAPACITY) {
          return;
        }
        // one column: right on the line; two: either side of it
        const side =
          c.directions.length === 1 ? 0 : (i === 0 ? -1 : 1) * PAIR_HALF_M;
        const w = epsgToWorld(c.x + ax * side, c.y + ay * side, ctx.offset);
        const h = bikeColumnHeight(d.count) + FOOT_SINK_M;
        m.makeScale(1, h, 1).setPosition(w.x, ground - FOOT_SINK_M, w.z);
        columns.setMatrixAt(n, m);
        tint.setHex(stale ? BIKE_STALE_TINT : BIKE_DIRECTION_TINTS[i % 2]);
        columns.setColorAt(n, tint);
        key.push(`${n}:${w.x.toFixed(1)}:${ground.toFixed(2)}:${h}:${stale}`);
        n++;
      });
    }
    const next = key.join("|");
    if (next === placed) {
      return false;
    }
    placed = next;
    columns.drawCount = n;
    columns.instanceMatrix.needsUpdate = true;
    if (columns.instanceTints) {
      columns.instanceTints.needsUpdate = true;
    }
    columns.computeBoundingSphere();
    return true;
  };

  return {
    group,
    counters: () => shown,
    dispose: () => {
      group.removeFromParent();
      columns.geometry.dispose();
      unit.dispose();
    },
    reground: place,
    set: (counters, at) => {
      shown = counters;
      now = at;
      place();
    },
  };
}

export interface BikeFeed {
  /** reads now, then every BIKE_POLL_MS; idempotent */
  start: () => void;
  /** stops polling and aborts a read in flight; idempotent */
  stop: () => void;
}

/**
 * The live counts, read while the layer is on: once when it is switched
 * on, then every five minutes, never while it is off. A failed read keeps
 * the last counts (the service is down for a moment, the columns stay).
 */
export function createBikeFeed(opts: {
  bounds: readonly [number, number, number, number];
  epsg: number;
  onCounts: (counters: BikeCounter[]) => void;
}): BikeFeed {
  let timer: ReturnType<typeof setInterval> | null = null;
  let aborter: AbortController | null = null;
  const read = async () => {
    aborter?.abort();
    const mine = new AbortController();
    aborter = mine;
    try {
      const doc = await fetchOptionalJson<unknown>(
        bikeCountsUrl(opts.epsg),
        mine.signal
      );
      if (doc !== null && aborter === mine) {
        opts.onCounts(parseBikeCounts(doc, opts.bounds));
      }
    } catch (err) {
      if (!isAbortError(err)) {
        throw err;
      }
    }
  };
  return {
    start: () => {
      if (timer !== null) {
        return;
      }
      void read();
      timer = setInterval(() => void read(), BIKE_POLL_MS);
    },
    stop: () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      aborter?.abort();
      aborter = null;
    },
  };
}
