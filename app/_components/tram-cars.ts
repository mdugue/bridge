import {
  BoxGeometry,
  Color,
  type BufferGeometry,
  Group,
  Matrix4,
  MeshStandardNodeMaterial,
  Vector3,
} from "three/webgpu";
import { positionLocal, vec3 } from "three/tsl";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { RAIL_TOP_M, RAIL_TOP_ON_DECK_M } from "@/lib/city/tram";
import {
  dayKindOf,
  type MeasuredPattern,
  measurePattern,
  pointAlong,
  previousDayKind,
  runningTrams,
  secondsOfDay,
  type TramDayKind,
  type TramTimetable,
} from "@/lib/city/tram-timetable";
import { Instances, instancePosition } from "./instancing";
import { mapWidenNode } from "./map-overlay";
import { type DeckPoly, deckLift } from "./rail-layer";
import { sceneMaterial } from "./three-utils";

/**
 * The trams by timetable (lib/city/tram-timetable.ts; DELFI via gtfs.de,
 * CC BY 4.0, on the OSM tracks) — a data layer (lib/city/data-layers.ts),
 * hidden unless the HUD switches it on.
 *
 * Every scheduled tram of the scene's kind of day is drawn where the
 * timetable has it at the scene's clock, which runs on in real time from
 * the instant the HUD set: a car of four sections, each following the
 * path on its own (so the car bends through a curve), standing at its
 * stops and easing out of and into them. A section rides the rail top
 * over the ground (the street bed's, lib/city/tram.ts) — on a bridge the
 * deck's, from the rail layer's lift table — and is hidden where its
 * ground has not streamed in. The cars do not cast: they move every frame,
 * and a moving caster would redraw the sun's shadow map in every one of
 * them. From the air they widen across with the bands (`mapWidenNode`).
 *
 * One set per part (body, window band, roof) over one shared matrix
 * buffer: three draw calls for every tram on the site. Site-wide, owned by
 * data-overlays.ts.
 */

/** One section's length (m) and the gap between two; four make the
 *  DVB's 30 m cars (NGT D8DD). */
const SECTION_M = 7.2;
const SECTION_GAP_M = 0.3;
const SECTIONS = 4;
const CAR_M = SECTIONS * SECTION_M + (SECTIONS - 1) * SECTION_GAP_M;
const CAR_WIDTH = 2.3;
/** The floor over the rail top, and the body's height above it (m). */
const FLOOR_M = 0.35;
const BODY_M = 2.9;
/** At most this many sections (≈ 250 trams). */
const CAPACITY = 1024;

const BODY = 0xf2_cf_5c; // the DVB's yellow, softened
const BAND = 0x5a_63_70; // the windows
const ROOF = 0xdc_d8_d0;

function partMaterial(color: number): MeshStandardNodeMaterial {
  return sceneMaterial(`tram-car:${color.toString(16)}`, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(color),
      roughness: 0.55,
    });
    m.positionNode = instancePosition(
      vec3(
        positionLocal.x.mul(mapWidenNode()),
        positionLocal.y,
        positionLocal.z
      )
    );
    return m;
  });
}

/** A box in the section's frame: x across, y up from the rail top, z
 *  along (the section's middle at 0). */
function part(w: number, h: number, l: number, y0: number): BufferGeometry {
  const g = new BoxGeometry(w, h, l);
  g.translate(0, y0 + h / 2, 0);
  return g;
}

export interface TramCarsStatus {
  /** the date whose timetable runs (the day kind's chosen date) */
  date: string | null;
  kind: TramDayKind;
  /** trams on their way now */
  running: number;
}

export interface TramCars {
  group: Group;
  dispose: () => void;
  /** places every running tram at the instant; returns the status */
  update: (at: Date) => TramCarsStatus;
}

export function createTramCars(
  timetable: TramTimetable,
  decks: DeckPoly[],
  ctx: GroundContext
): TramCars {
  const patterns: MeasuredPattern[] = timetable.patterns.map(measurePattern);
  const group = new Group();
  group.name = "tram-cars";
  const parts = [
    { geo: part(CAR_WIDTH, BODY_M, SECTION_M, FLOOR_M), color: BODY },
    {
      geo: part(CAR_WIDTH + 0.04, 0.95, SECTION_M - 0.8, FLOOR_M + 1.15),
      color: BAND,
    },
    {
      geo: part(CAR_WIDTH - 0.5, 0.3, SECTION_M - 1.6, FLOOR_M + BODY_M),
      color: ROOF,
    },
  ];
  // One matrix per section, shared by the three parts: the body owns it.
  const sets: Instances[] = [];
  parts.forEach(({ geo, color }, i) => {
    const set = new Instances(
      geo,
      partMaterial(color),
      CAPACITY,
      sets[0]?.instanceMatrix
    );
    set.name = `tram-car-${["body", "band", "roof"][i]}`;
    set.castShadow = false;
    set.receiveShadow = true;
    // The cars span the site and move every frame: never culled as a set.
    set.frustumCulled = false;
    set.drawCount = 0;
    group.add(set);
    sets.push(set);
  });
  const [body] = sets;
  const m = new Matrix4();
  const xAxis = new Vector3();
  const yAxis = new Vector3();
  const zAxis = new Vector3();

  /** The rail top at a point of a path, or null off the loaded ground. */
  const railTop = (x: number, y: number, onBridge: boolean): number | null => {
    if (onBridge) {
      const w = epsgToWorld(x, y, ctx.offset);
      const deck = deckLift(decks, w.x, w.z);
      if (deck !== null) {
        return deck + RAIL_TOP_ON_DECK_M;
      }
    }
    const ground = ctx.heightAt(x, y);
    return ground === null ? null : ground + RAIL_TOP_M.street;
  };

  const update = (at: Date): TramCarsStatus => {
    const kind = dayKindOf(at);
    const running = runningTrams(
      timetable,
      kind,
      previousDayKind(at),
      secondsOfDay(at)
    );
    let n = 0;
    for (const tram of running) {
      const p = patterns[tram.pattern];
      // At its first stop the whole car stands on the path.
      const head = Math.max(tram.head, CAR_M);
      for (let k = 0; k < SECTIONS && n < CAPACITY; k++) {
        const front = head - k * (SECTION_M + SECTION_GAP_M);
        const a = pointAlong(p, front);
        const b = pointAlong(p, front - SECTION_M);
        const ya = railTop(a.x, a.y, a.onBridge);
        const yb = railTop(b.x, b.y, b.onBridge);
        if (ya === null || yb === null) {
          continue;
        }
        const wa = epsgToWorld(a.x, a.y, ctx.offset);
        const wb = epsgToWorld(b.x, b.y, ctx.offset);
        zAxis.set(wa.x - wb.x, ya - yb, wa.z - wb.z);
        if (zAxis.lengthSq() === 0) {
          continue;
        }
        zAxis.normalize();
        xAxis.set(0, 1, 0).cross(zAxis).normalize();
        yAxis.copy(zAxis).cross(xAxis);
        m.makeBasis(xAxis, yAxis, zAxis).setPosition(
          (wa.x + wb.x) / 2,
          (ya + yb) / 2,
          (wa.z + wb.z) / 2
        );
        body.setMatrixAt(n, m);
        n++;
      }
    }
    for (const set of sets) {
      set.drawCount = n;
    }
    body.instanceMatrix.needsUpdate = true;
    return {
      date: timetable.days[kind]?.date ?? null,
      kind,
      running: running.length,
    };
  };

  return {
    group,
    dispose: () => {
      group.removeFromParent();
      for (const set of sets) {
        set.geometry.dispose();
      }
      for (const { geo } of parts) {
        geo.dispose();
      }
    },
    update,
  };
}
