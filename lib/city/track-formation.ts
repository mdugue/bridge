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

/** What lowering one object's tops does: its vertex index → new height. */
type Lowered = Map<number, number>;

/** The tops of one object the tracks run on, as the heights its vertices
 *  go down to; none when no track does. */
function formationOf(
  o: CityObject,
  vertex: (i: number) => [number, number, number],
  samples: SampleGrid,
  beds: readonly Bed[]
): Lowered {
  const lowered: Lowered = new Map();
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
      const xs = ring2.map((p) => p[0]);
      const ys = ring2.map((p) => p[1]);
      const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
      const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
      let run = 0;
      let cap = Infinity;
      let conflict = false;
      for (const s of samples.within(x0, y0, x1, y1)) {
        const over = top - s.z;
        if (over <= 0 || !inside(s.x, s.y, ring2)) {
          continue;
        }
        if (over >= FORMATION_M) {
          conflict = true; // a top far enough over a track: a roof, kept
          break;
        }
        run += s.length;
        cap = Math.min(cap, s.z - beds[s.bed].drop);
      }
      if (conflict || run < FORMATION_RUN_M) {
        continue;
      }
      for (const i of ring) {
        lowered.set(i, Math.min(lowered.get(i) ?? Infinity, cap));
      }
    }
  }
  return lowered;
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
    const tops = formationOf(o, vertex, samples, beds);
    if (tops.size === 0) {
      continue;
    }
    // every vertex of the object at a lowered top's height goes with it
    const band = Math.max(...[...tops.keys()].map((i) => vertex(i)[2]));
    const cap = Math.min(...tops.values());
    const copies = new Map<number, number>();
    const to = (i: number): number => {
      const z = vertex(i)[2];
      if (z <= cap || z < band - FLAT_M || z > band + 0.01) {
        return i;
      }
      let k = copies.get(i);
      if (k === undefined) {
        k = vertices.length;
        const raw = doc.vertices[i];
        vertices.push([
          raw[0],
          raw[1],
          Math.round((cap - translate[2]) / scale[2]),
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
