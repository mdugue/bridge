import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Vector3,
} from "three/webgpu";
import {
  attribute,
  color,
  float,
  mix,
  positionLocal,
  vec3,
  vec4,
} from "three/tsl";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { RAIL_TOP_M, RAIL_TOP_ON_DECK_M } from "@/lib/city/tram";
import {
  carLength,
  dayKindOf,
  type MeasuredPattern,
  measurePattern,
  pointAlong,
  previousDayKind,
  routeOperator,
  runningTrams,
  secondsOfDay,
  type TramDayKind,
  TRAM_LIVERIES,
  TRAM_TINTS,
  type TramLivery,
  type TramOperator,
  type TramTimetable,
} from "@/lib/city/tram-timetable";
import { dataMarkAlpha, dataMarkColour } from "./glass";
import { Instances, instancePosition, instanceTint } from "./instancing";
import { mapWidenNode } from "./map-overlay";
import { type DeckPoly, deckLift } from "@/lib/city/decks";
import type { F, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * The trams by timetable (lib/city/tram-timetable.ts; DELFI via gtfs.de,
 * CC BY 4.0, on the OSM tracks) — a data layer (lib/city/data-layers.ts),
 * hidden unless the HUD switches it on.
 *
 * Every scheduled tram of the scene's kind of day is drawn where the
 * timetable has it at the scene's clock, which runs on in real time from
 * the instant the HUD set: a car in its operator's livery and of a length
 * its fleet runs (the timetable's agency, `TRAM_LIVERIES`: Dresden's
 * yellow 30, 41 and 45 m cars, Leipzig's silver-grey with a yellow band
 * and a blue skirt, Munich's blue — drawn per trip by the fleet's mix),
 * of sections about 7.5 m long, each following the
 * path on its own (so the car bends through a curve), standing at its
 * stops and easing out of and into them. A section rides the rail top
 * over the ground (the street bed's, lib/city/tram.ts) — on a bridge the
 * deck's, from the rail layer's lift table — and is hidden where its
 * ground has not streamed in. The cars do not cast: they move every frame,
 * and a moving caster would redraw the sun's shadow map in every one of
 * them. From the air they widen across with the traffic flows (`mapWidenNode`).
 *
 * One set per part (body, skirt, window band, roof band, roof) over one
 * shared matrix buffer, the livery's colours per instance: five draw
 * calls for every tram on the site. Site-wide, owned by data-overlays.ts.
 */

/** A section's drawn length (m; the matrix stretches it to the car's),
 *  the length a section stands for, and the gap between two: a 30 m car is
 *  four sections, a 45 m one six. */
const SECTION_M = 7.2;
const SECTION_EVERY_M = 7.5;
const SECTION_GAP_M = 0.3;
const CAR_WIDTH = 2.3;
/** The skirt's and the roof band's heights (m). */
const SKIRT_M = 0.45;
const TOP_BAND_M = 0.3;
/** The floor over the rail top, and the body's height above it (m). */
const FLOOR_M = 0.35;
const BODY_M = 2.9;
/** At most this many sections (≈ 250 trams). */
const CAPACITY = 1024;

/** The light a car trails along its track (deck.gl's TripsLayer, in the
 *  scene's palette): its length (m), its samples, its width (m) and lift
 *  over the rail top (m) — over the coarse terrain level too, whose grid
 *  stands up to half a metre over the fine TIN the rail top is read from.
 *  A map mark like the flows: it widens from the air. */
const TRAIL_M = 140;
const TRAIL_POINTS = 24;
const TRAIL_WIDTH = 3.2;
const TRAIL_LIFT = 0.6;
const TRAIL = TRAM_TINTS.trail;
/** At most this many trams trail (≈ the site's busiest minute × 2). */
const TRAIL_CAPACITY = 256;

const BAND = 0x5a_63_70; // the windows
const ROOF = 0xdc_d8_d0;
const OPERATORS = Object.keys(TRAM_LIVERIES) as TramOperator[];

const xyOf = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

/** A part's material: of one colour, or (`null`) the instance's tint —
 *  the livery's parts, coloured per car. */
function partMaterial(color: number | null): MeshStandardNodeMaterial {
  const key = color === null ? "livery" : color.toString(16);
  return sceneMaterial(`tram-car:${key}`, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(color ?? 0xff_ff_ff),
      roughness: 0.55,
    });
    if (color === null) {
      m.colorNode = instanceTint();
    }
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

/** A car of `length` m: how many sections, and the stretch of each
 *  section's drawn length to its own. */
export function carSections(length: number): {
  n: number;
  stretch: number;
} {
  const n = Math.max(2, Math.round(length / SECTION_EVERY_M));
  return { n, stretch: (length - (n - 1) * SECTION_GAP_M) / n / SECTION_M };
}

/** A box in the section's frame: x across, y up from the rail top, z
 *  along (the section's middle at 0). */
function part(w: number, h: number, l: number, y0: number): BufferGeometry {
  const g = new BoxGeometry(w, h, l);
  g.translate(0, y0 + h / 2, 0);
  return g;
}

function trailMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("tram-trail", () => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const fade = attribute("trailFade", "float") as F;
    const across = attribute("trailAcross", "vec3") as V3;
    m.positionNode = positionLocal.add(across.mul(mapWidenNode().sub(1)));
    // Warm white at the car, the line's gold behind, gone at the end.
    const glow = mix(color(TRAIL), vec3(1, 0.98, 0.9), fade.pow(6)) as V3;
    // Under a picture style, the style's mark (glass.ts): the middle of
    // its scale, the car's end of the trail as its light.
    const styled = dataMarkColour({
      glass: glow,
      // reason: a colour node is a vec3 in the graph; its type says Color.
      tint: color(TRAIL) as unknown as V3,
      scale: float(0.5),
      light: fade.pow(6),
      edge: float(0),
      ink: float(1),
      backdrop: false,
    });
    m.colorNode = vec4(styled, dataMarkAlpha(fade.pow(1.4).mul(0.85)));
    m.userData.paperOwn = true;
    return m;
  });
}

/** The trails' one mesh, rewritten every frame: a ribbon of
 *  TRAIL_POINTS cross-sections per tram, collapsed where its ground is
 *  missing. */
function createTrails() {
  const verts = TRAIL_CAPACITY * TRAIL_POINTS * 2;
  const position = new BufferAttribute(new Float32Array(verts * 3), 3);
  const across = new BufferAttribute(new Float32Array(verts * 3), 3);
  const fade = new BufferAttribute(new Float32Array(verts), 1);
  for (const a of [position, across, fade]) {
    a.setUsage(DynamicDrawUsage);
  }
  const index: number[] = [];
  for (let t = 0; t < TRAIL_CAPACITY; t++) {
    for (let k = 0; k < TRAIL_POINTS - 1; k++) {
      const a = (t * TRAIL_POINTS + k) * 2;
      // left, right of each cross-section, running back along the path:
      // wound to face up
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", position);
  geo.setAttribute("trailAcross", across);
  geo.setAttribute("trailFade", fade);
  geo.setIndex(index);
  geo.setDrawRange(0, 0);
  const mesh = new Mesh(geo, trailMaterial());
  mesh.name = "tram-trails";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  let count = 0;
  return {
    mesh,
    begin: () => {
      count = 0;
    },
    /** One tram's trail, from `from` back along its path. */
    add: (
      p: MeasuredPattern,
      from: number,
      railTop: (x: number, y: number, onBridge: boolean) => number | null,
      offset: { cx: number; cy: number }
    ) => {
      if (count >= TRAIL_CAPACITY) {
        return;
      }
      const base = count * TRAIL_POINTS * 2;
      let lastY: number | null = null;
      for (let k = 0; k < TRAIL_POINTS; k++) {
        const t = k / (TRAIL_POINTS - 1);
        const at = pointAlong(p, Math.max(from - t * TRAIL_M, 0));
        const y: number | null = railTop(at.x, at.y, at.onBridge) ?? lastY;
        lastY = y;
        // past the path's start the trail has run out: fade it there
        const left = from - t * TRAIL_M >= 0 ? 1 - t : 0;
        const w = epsgToWorld(at.x, at.y, offset);
        // across the track, in the world frame (z = −y)
        const ax = at.dir[1] * (TRAIL_WIDTH / 2);
        const az = at.dir[0] * (TRAIL_WIDTH / 2);
        for (const side of [-1, 1]) {
          const v = base + k * 2 + (side + 1) / 2;
          position.setXYZ(
            v,
            w.x + ax * side,
            (y ?? 0) + TRAIL_LIFT,
            w.z + az * side
          );
          across.setXYZ(v, ax * side, 0, az * side);
          fade.setX(v, y === null ? 0 : left);
        }
      }
      count++;
    },
    end: () => {
      geo.setDrawRange(0, count * (TRAIL_POINTS - 1) * 6);
      position.needsUpdate = true;
      across.needsUpdate = true;
      fade.needsUpdate = true;
    },
    dispose: () => {
      geo.dispose();
    },
  };
}

export interface TramCarsStatus {
  /** the date whose timetable runs (the day kind's chosen date) */
  date: string | null;
  /** set when the timetable could not be loaded: what the HUD says */
  failed?: string;
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
  // the livery's parts take their colour per car (`tint`), the rest are
  // every car's alike
  const parts: {
    color: number | null;
    geo: BufferGeometry;
    name: string;
    tint?: keyof Omit<TramLivery, "lengths">;
  }[] = [
    {
      geo: part(CAR_WIDTH, BODY_M, SECTION_M, FLOOR_M),
      color: null,
      name: "body",
      tint: "body",
    },
    {
      geo: part(CAR_WIDTH + 0.04, 0.95, SECTION_M - 0.8, FLOOR_M + 1.15),
      color: BAND,
      name: "band",
    },
    {
      geo: part(CAR_WIDTH - 0.5, 0.3, SECTION_M - 1.6, FLOOR_M + BODY_M),
      color: ROOF,
      name: "roof",
    },
    {
      geo: part(CAR_WIDTH + 0.02, SKIRT_M, SECTION_M + 0.02, FLOOR_M - 0.01),
      color: null,
      name: "skirt",
      tint: "skirt",
    },
    {
      geo: part(
        CAR_WIDTH + 0.02,
        TOP_BAND_M,
        SECTION_M + 0.02,
        FLOOR_M + BODY_M - TOP_BAND_M - 0.05
      ),
      color: null,
      name: "top",
      tint: "top",
    },
  ];
  // One matrix per section, shared by every part: the body owns it.
  const sets: Instances[] = [];
  parts.forEach(({ geo, color, name, tint: tinted }) => {
    const set = new Instances(
      geo,
      partMaterial(color),
      CAPACITY,
      sets[0]?.instanceMatrix
    );
    set.name = `tram-car-${name}`;
    set.castShadow = false;
    set.receiveShadow = true;
    // The cars span the site and move every frame: never culled as a set.
    set.frustumCulled = false;
    set.drawCount = 0;
    if (tinted) {
      // its tints from the start: a set compiled while no car runs builds
      // its material with them, and three would not rebuild it for them
      set.setColorAt(0, new Color(1, 1, 1));
    }
    group.add(set);
    sets.push(set);
  });
  const [body] = sets;
  // which operator's colours each slot holds (-1: none yet)
  const slotOperator = new Int8Array(CAPACITY).fill(-1);
  const tint = new Color();
  const paint = (slot: number, operator: TramOperator): boolean => {
    const k = OPERATORS.indexOf(operator);
    if (slotOperator[slot] === k) {
      return false;
    }
    slotOperator[slot] = k;
    const livery = TRAM_LIVERIES[operator];
    parts.forEach((p, i) => {
      if (p.tint) {
        sets[i].setColorAt(slot, tint.setHex(livery[p.tint]));
      }
    });
    return true;
  };
  const trails = createTrails();
  group.add(trails.mesh);
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
    let repainted = false;
    trails.begin();
    for (const tram of running) {
      const p = patterns[tram.pattern];
      const operator = routeOperator(timetable, tram.routeIndex);
      const carM = carLength(TRAM_LIVERIES[operator], tram.seed);
      const { n: sections, stretch } = carSections(carM);
      const sectionM = SECTION_M * stretch;
      // At its first stop the whole car stands on the path.
      const head = Math.max(tram.head, carM);
      if (ctx.heightAt(...xyOf(pointAlong(p, head))) !== null) {
        trails.add(p, head - carM, railTop, ctx.offset);
      }
      for (let k = 0; k < sections && n < CAPACITY; k++) {
        const front = head - k * (sectionM + SECTION_GAP_M);
        const a = pointAlong(p, front);
        const b = pointAlong(p, front - sectionM);
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
        m.makeBasis(xAxis, yAxis, zAxis.multiplyScalar(stretch)).setPosition(
          (wa.x + wb.x) / 2,
          (ya + yb) / 2,
          (wa.z + wb.z) / 2
        );
        body.setMatrixAt(n, m);
        repainted = paint(n, operator) || repainted;
        n++;
      }
    }
    for (const set of sets) {
      set.drawCount = n;
      if (repainted && set.instanceTints) {
        set.instanceTints.needsUpdate = true;
      }
    }
    body.instanceMatrix.needsUpdate = true;
    trails.end();
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
      trails.dispose();
    },
    update,
  };
}
