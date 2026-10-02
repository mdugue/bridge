import type { BikeFeedReader } from "@/lib/city/bike-feeds";
import {
  CircleGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  LatheGeometry,
  Matrix4,
  MeshBasicNodeMaterial,
  Vector2,
} from "three/webgpu";
import {
  float,
  fract,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import {
  acrossStreet,
  type BikeCounter,
  BIKE_DIRECTION_TINTS,
  BIKE_STALE_TINT,
  BIKE_POLL_MS,
  bikeColumnHeight,
  isStale,
} from "@/lib/city/bike-counts";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { fetchOptionalJson, isAbortError } from "./fetch-optional";
import { dataTime, glassColour, glassGrazing } from "./glass";
import {
  Instances,
  instanceFloat,
  instancePosition,
  instanceTint,
} from "./instancing";
import { mapWidenNode } from "./map-overlay";
import { sceneMaterial } from "./three-utils";

/**
 * The city's permanent bicycle counters, live (lib/city/bike-counts.ts;
 * Landeshauptstadt Dresden, dl-de/by-2-0) — a data layer
 * (lib/city/data-layers.ts), hidden unless the HUD switches it on, and
 * fetched only then.
 *
 * Per counter a pair of glass columns either side of the street, one per
 * direction (teal the first, lilac the second, as the HUD's list names
 * them), each as tall as the root of its bicycles in the last counted hour
 * (`bikeColumnHeight`), its top rounded. The glass (glass.ts) bends the
 * street behind it; inside, rings of light rise — faster the more
 * bicycles passed — and a soft pool of the column's colour lies on the
 * ground around its foot. A counter whose count is older than three hours
 * stands grey and still. From the air the columns and their pools widen
 * with the traffic bodies (`mapWidenNode`). They stand on the ground under
 * the counter — feet a row under it (ADR 0035's 0.2 m of a box), so a
 * slope beside it buries the downhill side's foot rather than leaving it
 * in the air — and are placed again as the ground streams in: a counter
 * over ground not loaded yet waits. No shadow: a data mark, not a body.
 * Site-wide, not per tile: one set for the 35 counters, owned by
 * data-overlays.ts.
 */

/** The column's radius (m) on foot, and its rounded top's share of a unit
 *  column (stretched with its height: a soft dome, never a cut face). */
const COLUMN_RADIUS = 0.75;
const CAP_SHARE = 0.06;
/** Half the distance between a counter's two columns (m). */
const PAIR_HALF_M = 1.1;
/** How far the foot goes under the ground (m; ADR 0035's box row). */
const FOOT_SINK_M = 0.2;
/** The pool of light at a column's foot: its radius (m) and its lift over
 *  the ground. */
const POOL_RADIUS_M = 3.2;
const POOL_LIFT_M = 0.08;
/** The rings: their spacing up the column (m), and how fast they rise per
 *  root of the hour's count (m/s). */
const RING_SPACING_M = 2.4;
const RING_SPEED = 0.18;
/** At most this many columns (the city runs 35 counters). */
const CAPACITY = 128;

/** A unit column standing on its foot (y 0..1), the top a soft dome. */
function columnGeometry(): LatheGeometry {
  const points = [new Vector2(0, 0), new Vector2(COLUMN_RADIUS, 0)];
  points.push(new Vector2(COLUMN_RADIUS, 1 - CAP_SHARE));
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    points.push(
      new Vector2(
        COLUMN_RADIUS * Math.cos(a),
        1 - CAP_SHARE + CAP_SHARE * Math.sin(a)
      )
    );
  }
  return new LatheGeometry(points, 24);
}

function columnMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("bike-glass", () => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    const widen = mapWidenNode();
    m.positionNode = instancePosition(
      vec3(
        positionLocal.x.mul(widen),
        positionLocal.y,
        positionLocal.z.mul(widen)
      )
    );
    const tint = instanceTint();
    const glass = glassColour({ tint, density: 0.5, rim: 0.9 });
    // Rings of light rising through the column, as fast as the bicycles
    // came (a still column where none did, or the count is stale).
    const rate = instanceFloat("bikeRate");
    const phase = fract(
      positionWorld.y.sub(dataTime.mul(rate)).div(RING_SPACING_M)
    );
    const ring = smoothstep(0, 0.1, phase).mul(
      float(1).sub(smoothstep(0.1, 0.3, phase))
    );
    const light = mix(tint, vec3(1), 0.4).mul(
      ring.mul(float(1).sub(glassGrazing().mul(0.6))).mul(0.55)
    );
    m.colorNode = glass.add(light);
    return m;
  });
}

/** The pool of colour on the ground: a soft disc, densest at its middle. */
function poolMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("bike-pool", () => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const widen = mapWidenNode();
    m.positionNode = instancePosition(
      vec3(
        positionLocal.x.mul(widen),
        positionLocal.y,
        positionLocal.z.mul(widen)
      )
    );
    const r = uv().sub(0.5).length().mul(2);
    const fall = float(1).sub(smoothstep(0.15, 1, r));
    m.colorNode = vec4(instanceTint(), fall.mul(fall).mul(0.55));
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

/** One direction's column: where it stands (the site's CRS) and how tall
 *  it is over its feet (m). */
export interface BikeColumn {
  direction: number;
  height: number;
  radius: number;
  x: number;
  y: number;
}

/** A counter's columns as drawn: one right on the line, two either side
 *  of it. The probe asks them by the same numbers (bike-ask.ts). */
export function bikeColumns(c: BikeCounter): BikeColumn[] {
  const [ax, ay] = acrossStreet(c.angleDeg);
  return c.directions.map((d, i) => {
    const side =
      c.directions.length === 1 ? 0 : (i === 0 ? -1 : 1) * PAIR_HALF_M;
    return {
      direction: i,
      height: bikeColumnHeight(d.count) + FOOT_SINK_M,
      radius: COLUMN_RADIUS,
      x: c.x + ax * side,
      y: c.y + ay * side,
    };
  });
}

/** How deep a column's foot goes under the ground (m). */
export const BIKE_FOOT_SINK_M = FOOT_SINK_M;

export function createBikeLayer(ctx: GroundContext): BikeLayer {
  const group = new Group();
  group.name = "bike-counters";
  const unit = columnGeometry();
  const columns = new Instances(unit, columnMaterial(), CAPACITY);
  columns.name = "bike-columns";
  const rates = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  columns.geometry.setAttribute("bikeRate", rates);
  const disc = new CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  const pools = new Instances(disc, poolMaterial(), CAPACITY);
  pools.name = "bike-pools";
  for (const set of [columns, pools]) {
    set.castShadow = false;
    set.receiveShadow = false;
    set.drawCount = 0;
    group.add(set);
  }
  // The pools under the glass: the glass's copy of the frame holds them.
  pools.renderOrder = 3;
  columns.renderOrder = 4;
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
      for (const column of bikeColumns(c)) {
        if (n >= CAPACITY) {
          break;
        }
        const i = column.direction;
        const d = c.directions[i];
        const w = epsgToWorld(column.x, column.y, ctx.offset);
        const h = column.height;
        m.makeScale(1, h, 1).setPosition(w.x, ground - FOOT_SINK_M, w.z);
        columns.setMatrixAt(n, m);
        const r = POOL_RADIUS_M * (0.6 + 0.4 * Math.min(h / 20, 1));
        m.makeScale(r, 1, r).setPosition(w.x, ground + POOL_LIFT_M, w.z);
        pools.setMatrixAt(n, m);
        tint.setHex(stale ? BIKE_STALE_TINT : BIKE_DIRECTION_TINTS[i % 2]);
        columns.setColorAt(n, tint);
        pools.setColorAt(n, tint);
        rates.setX(n, stale ? 0 : RING_SPEED * Math.sqrt(d.count));
        key.push(`${n}:${w.x.toFixed(1)}:${ground.toFixed(2)}:${h}:${stale}`);
        n++;
      }
    }
    const next = key.join("|");
    if (next === placed) {
      return false;
    }
    placed = next;
    rates.needsUpdate = true;
    for (const set of [columns, pools]) {
      set.drawCount = n;
      set.instanceMatrix.needsUpdate = true;
      if (set.instanceTints) {
        set.instanceTints.needsUpdate = true;
      }
      set.computeBoundingSphere();
    }
    return true;
  };

  return {
    group,
    counters: () => shown,
    dispose: () => {
      group.removeFromParent();
      columns.geometry.dispose();
      pools.geometry.dispose();
      unit.dispose();
      disc.dispose();
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
  /** the site's feed (lib/city/bike-feeds.ts) */
  feed: BikeFeedReader;
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
        opts.feed.url(opts.bounds, opts.epsg),
        mine.signal
      );
      if (doc !== null && aborter === mine) {
        opts.onCounts(opts.feed.parse(doc, opts.bounds, opts.epsg));
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
