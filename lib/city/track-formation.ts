/**
 * A building a track runs over is the structure the track is laid on, not
 * a roof above it. Nothing stands that low over a track: a train's roof is
 * 4 m and more over its rails and the clearance above them 4.3 m at least
 * (EBO §9), so a flat LoD2 top that lies less than FORMATION_M over a
 * track's profile where the track runs on it for FORMATION_RUN_M is the
 * formation under the track — the deck of an underpass, the arches of a
 * viaduct, an embankment ALKIS keeps as a building — that LoD2 drew a
 * little too high. West of Dresden's Hauptbahnhof the tracks ran 0.4 m
 * under such a top (ALKIS 31001_9998, 159 × 166 m) for a kilometre of
 * track, and only the catenary showed where they were. The build step
 * (scripts/prepare-data.ts) lowers such a top to the bed the track lies on
 * (lib/city/track-beds.ts: the profile less its ballast), its walls with
 * it, before the buildings are baked. DOM-free, THREE-free.
 */

import { isOpenRoof } from "./open-roofs";
import type { Bed } from "./track-beds";
import type { CityJsonDocument, CityObject } from "./types";

/** A top less than this over a track's profile (m) is its formation. */
export const FORMATION_M = 1.5;
/** …where the track runs over it for at least this (m): a track grazing a
 *  building's corner (OSM or the DLM a metre off) leaves it as it is. */
export const FORMATION_RUN_M = 20;
/** A face whose corners lie within this of each other in height (m) is a
 *  flat top. */
const FLAT_M = 0.3;

type Ring2 = readonly (readonly [number, number])[];

/** Whether (x, y) lies inside a ring. */
function inside(x: number, y: number, ring: Ring2): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      c = !c;
    }
  }
  return c;
}

/** Every surface (outer ring first) under a geometry's boundaries. */
function surfaces(b: unknown, out: number[][][] = []): number[][][] {
  if (!Array.isArray(b) || b.length === 0) {
    return out;
  }
  const first: unknown = b[0];
  if (Array.isArray(first) && typeof first[0] === "number") {
    out.push(b as number[][]);
    return out;
  }
  for (const child of b) {
    surfaces(child, out);
  }
  return out;
}

/** A bed's samples with the track length each stands for (m). */
interface Sample {
  bed: number;
  length: number;
  x: number;
  y: number;
  z: number;
}

/** The samples' grid cell (m). */
const CELL_M = 16;

/** The samples by grid cell. */
class SampleGrid {
  private readonly cells = new Map<string, Sample[]>();
  readonly size: number;
  constructor(samples: readonly Sample[]) {
    this.size = samples.length;
    for (const s of samples) {
      const k = `${Math.floor(s.x / CELL_M)}:${Math.floor(s.y / CELL_M)}`;
      const cell = this.cells.get(k);
      if (cell) {
        cell.push(s);
      } else {
        this.cells.set(k, [s]);
      }
    }
  }
  /** Every sample in the box. */
  *within(x0: number, y0: number, x1: number, y1: number): Generator<Sample> {
    for (
      let cx = Math.floor(x0 / CELL_M);
      cx <= Math.floor(x1 / CELL_M);
      cx++
    ) {
      for (
        let cy = Math.floor(y0 / CELL_M);
        cy <= Math.floor(y1 / CELL_M);
        cy++
      ) {
        for (const s of this.cells.get(`${cx}:${cy}`) ?? []) {
          if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) {
            yield s;
          }
        }
      }
    }
  }
}

function samplesOf(beds: readonly Bed[]): Sample[] {
  const out: Sample[] = [];
  beds.forEach((bed, k) => {
    if (bed.shallow !== undefined) {
      return; // a line in a cut runs under what lies over it
    }
    const n = bed.coords.length;
    bed.coords.forEach(([x, y], i) => {
      const prev = i > 0 ? bed.coords[i - 1] : bed.coords[i];
      const next = i + 1 < n ? bed.coords[i + 1] : bed.coords[i];
      const length =
        (Math.hypot(x - prev[0], y - prev[1]) +
          Math.hypot(next[0] - x, next[1] - y)) /
        2;
      out.push({ bed: k, length, x, y, z: bed.z[i] });
    });
  });
  return out;
}

/** A flat top a track runs on: its outline, its height and the bed's
 *  height it goes down to. */
interface Formation {
  cap: number;
  ring: Ring2;
  top: number;
}

/** A top is lowered only this far above its object's foot (m): a box
 *  whose top a track runs on is never pressed flat. */
const KEEP_M = 0.5;
/** A vertex this close to a top's outline is on it (m). */
const ON_M = 0.05;

/** Whether (x, y) lies on or inside a ring. */
function onOrInside(x: number, y: number, ring: Ring2): boolean {
  if (inside(x, y, ring)) {
    return true;
  }
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 > 0
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
        : 0;
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= ON_M) {
      return true;
    }
  }
  return false;
}

/** The track's run over one flat top and the bed it goes down to; null
 *  when a track runs too far under it (a roof) or too briefly on it. */
function capOf(
  ring2: Ring2,
  top: number,
  samples: SampleGrid,
  beds: readonly Bed[]
): number | null {
  const xs = ring2.map((p) => p[0]);
  const ys = ring2.map((p) => p[1]);
  let run = 0;
  let cap = Infinity;
  for (const s of samples.within(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys)
  )) {
    const over = top - s.z;
    if (over <= 0 || !inside(s.x, s.y, ring2)) {
      continue;
    }
    if (over >= FORMATION_M) {
      return null; // a top far enough over a track: a roof, kept
    }
    run += s.length;
    cap = Math.min(cap, s.z - beds[s.bed].drop);
  }
  return run < FORMATION_RUN_M ? null : cap;
}

/** The flat tops of one object the tracks run on; none when no track
 *  does. `foot` is the object's lowest vertex height. */
function formationsOf(
  o: CityObject,
  vertex: (i: number) => [number, number, number],
  samples: SampleGrid,
  beds: readonly Bed[],
  foot: number
): Formation[] {
  const out: Formation[] = [];
  for (const g of o.geometry ?? []) {
    for (const face of surfaces((g as { boundaries?: unknown }).boundaries)) {
      const ring = face[0];
      if (!ring || ring.length < 3) {
        continue;
      }
      const pts = ring.map(vertex);
      const zs = pts.map((p) => p[2]);
      const top = Math.max(...zs);
      if (top - Math.min(...zs) > FLAT_M) {
        continue;
      }
      const ring2 = pts.map((p): [number, number] => [p[0], p[1]]);
      const cap = capOf(ring2, top, samples, beds);
      if (cap !== null && cap > foot + KEEP_M) {
        out.push({ cap, ring: ring2, top });
      }
    }
  }
  return out;
}

/** The height a vertex goes down to: the lowest cap of the tops it lies
 *  at (on its outline or inside it, within the top's flat band); its own
 *  height where it lies at none. */
function loweredTo(
  [x, y, z]: [number, number, number],
  tops: readonly Formation[]
): number {
  let to = z;
  for (const t of tops) {
    if (
      z > t.cap &&
      z >= t.top - FLAT_M &&
      z <= t.top + 0.01 &&
      onOrInside(x, y, t.ring)
    ) {
      to = Math.min(to, t.cap);
    }
  }
  return to;
}

/** Every vertex index under a geometry's boundaries. */
function indices(b: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof b === "number") {
    out.add(b);
  } else if (Array.isArray(b)) {
    for (const c of b) {
      indices(c, out);
    }
  }
  return out;
}

/** An object's ALKIS function, or its parent's (a BuildingPart's). */
function functionOf(doc: CityJsonDocument, o: CityObject): unknown {
  return (
    o.attributes?.function ??
    o.parents
      ?.map((p) => doc.CityObjects[p]?.attributes?.function)
      .find(Boolean)
  );
}

/** A geometry's boundaries with its vertex indices mapped. */
function remap(b: unknown, to: (i: number) => number): unknown {
  if (typeof b === "number") {
    return to(b);
  }
  return Array.isArray(b) ? b.map((c) => remap(c, to)) : b;
}

/**
 * The document with every top a track runs on lowered to the track's bed
 * (`beds`: the site's, those reaching into the tile), and with it every
 * vertex of the object at that top's height. The original vertices stay
 * (the loader recenters over them, and another object may share them): a
 * lowered object takes copies, appended. The same document where no track
 * runs on a top.
 */
export function onFormations(
  doc: CityJsonDocument,
  beds: readonly Bed[]
): { doc: CityJsonDocument; lowered: string[] } {
  const samples = new SampleGrid(samplesOf(beds));
  if (samples.size === 0) {
    return { doc, lowered: [] };
  }
  const { scale, translate } = doc.transform ?? {
    scale: [1, 1, 1],
    translate: [0, 0, 0],
  };
  const vertex = (i: number): [number, number, number] => {
    const [x, y, z] = doc.vertices[i];
    return [
      x * scale[0] + translate[0],
      y * scale[1] + translate[1],
      z * scale[2] + translate[2],
    ];
  };
  const vertices = doc.vertices.slice();
  const CityObjects: CityJsonDocument["CityObjects"] = { ...doc.CityObjects };
  const lowered: string[] = [];
  for (const [id, o] of Object.entries(doc.CityObjects)) {
    if (isOpenRoof(functionOf(doc, o))) {
      continue; // a roof on posts is drawn open: the track runs under it
    }
    const used = new Set<number>();
    for (const g of o.geometry ?? []) {
      indices((g as { boundaries?: unknown }).boundaries, used);
    }
    if (used.size === 0) {
      continue;
    }
    const foot = Math.min(...[...used].map((i) => vertex(i)[2]));
    const tops = formationsOf(o, vertex, samples, beds, foot);
    if (tops.length === 0) {
      continue;
    }
    // every vertex of the object at a lowered top's height, on or inside
    // its outline, goes down with it
    const copies = new Map<number, number>();
    const to = (i: number): number => {
      const z = loweredTo(vertex(i), tops);
      if (z === vertex(i)[2]) {
        return i;
      }
      let k = copies.get(i);
      if (k === undefined) {
        k = vertices.length;
        const raw = doc.vertices[i];
        vertices.push([
          raw[0],
          raw[1],
          Math.round((z - translate[2]) / scale[2]),
        ]);
        copies.set(i, k);
      }
      return k;
    };
    CityObjects[id] = {
      ...o,
      geometry: (o.geometry ?? []).map((g) => ({
        ...(g as object),
        boundaries: remap((g as { boundaries?: unknown }).boundaries, to),
      })),
    };
    lowered.push(id);
  }
  return lowered.length === 0
    ? { doc, lowered }
    : { doc: { ...doc, vertices, CityObjects }, lowered };
}
