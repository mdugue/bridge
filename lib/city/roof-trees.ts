/**
 * Canopy points that are a LoD2 building's roof. DOM1 − DGM1 over a roof
 * is the roof's height, and where the Basis-DLM still files the ground as
 * park (halls built since, west of the Yenidze) the canopy bake planted a
 * grove on it. A point well inside a footprint and no taller than
 * the building (plus ROOF_REACH_M) is its roof; a taller one is a tree
 * over a shed or garage, and stays. Dropped at build time
 * (scripts/prepare-data.ts `publishCanopy`, scripts/coarse-crowns.ts) like
 * the scan structures' sheds (small-buildings.ts), so every site gets it
 * without a re-bake. No THREE, no DOM.
 */
import type { PointGeometry } from "./features";
import { buildingFootprintPolys } from "./minimap";
import { segmentDistance2 } from "./small-buildings";
import type { CityJsonDocument } from "./types";

/** Only this far inside a footprint is a point the building's own (m): a
 *  crown beside a wall may peak over its eave. */
export const ROOF_INSET_M = 1;
/** A point inside a footprint this little taller than the building is its
 *  roof, not a tree standing over it (m). */
export const ROOF_REACH_M = 2;

/** A LoD2 object's ground ring (EPSG metres) and its height over its own
 *  lowest vertex. */
export interface RoofFootprint {
  height: number;
  /** its courtyards: a point in one is outside the building */
  holes?: [number, number][][];
  ring: [number, number][];
}

const CELL = 32;

function vertexIds(nested: unknown, out: number[]): void {
  if (typeof nested === "number") {
    out.push(nested);
  } else if (Array.isArray(nested)) {
    for (const item of nested) {
      vertexIds(item, out);
    }
  }
}

/** Each Building's and BuildingPart's footprint rings with its height. */
export function lod2Roofs(doc: CityJsonDocument): RoofFootprint[] {
  const [, , sz] = doc.transform?.scale ?? [1, 1, 1];
  const [, , tz] = doc.transform?.translate ?? [0, 0, 0];
  const out: RoofFootprint[] = [];
  for (const [id, obj] of Object.entries(doc.CityObjects)) {
    const ids: number[] = [];
    for (const g of obj.geometry ?? []) {
      vertexIds((g as { boundaries?: unknown }).boundaries, ids);
    }
    if (ids.length === 0) {
      continue;
    }
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const i of ids) {
      const z = doc.vertices[i][2] * sz + tz;
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    for (const poly of buildingFootprintPolys({
      ...doc,
      CityObjects: { [id]: obj },
    })) {
      out.push({ height: hi - lo, holes: poly.holes, ring: poly.pts });
    }
  }
  return out;
}

function inside(ring: readonly [number, number][], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

function nearEdge(
  ring: readonly [number, number][],
  x: number,
  y: number,
  inset: number
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    if (segmentDistance2(x, y, ax, ay, bx, by) < inset * inset) {
      return true;
    }
  }
  return false;
}

/** Whether (x, y) lies inside the footprint (not in a courtyard), at least
 *  `inset` from every edge. */
function wellInside(roof: RoofFootprint, x: number, y: number, inset: number) {
  const holes = roof.holes ?? [];
  return (
    inside(roof.ring, x, y) &&
    !holes.some((h) => inside(h, x, y)) &&
    !nearEdge(roof.ring, x, y, inset) &&
    !holes.some((h) => nearEdge(h, x, y, inset))
  );
}

/** The canopy points that are not a LoD2 roof (see the module comment). */
export function treesOffRoofs<
  F extends { geometry: PointGeometry; properties: { h: number } | null },
>(trees: readonly F[], roofs: readonly RoofFootprint[]): F[] {
  const cells = new Map<string, RoofFootprint[]>();
  for (const roof of roofs) {
    const xs = roof.ring.map((p) => p[0]);
    const ys = roof.ring.map((p) => p[1]);
    for (
      let cx = Math.floor(Math.min(...xs) / CELL);
      cx <= Math.floor(Math.max(...xs) / CELL);
      cx++
    ) {
      for (
        let cy = Math.floor(Math.min(...ys) / CELL);
        cy <= Math.floor(Math.max(...ys) / CELL);
        cy++
      ) {
        const key = `${cx},${cy}`;
        const bucket = cells.get(key);
        if (bucket) {
          bucket.push(roof);
        } else {
          cells.set(key, [roof]);
        }
      }
    }
  }
  return trees.filter((t) => {
    const [x, y] = t.geometry.coordinates;
    const h = t.properties?.h ?? Number.POSITIVE_INFINITY;
    const bucket = cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
    return !bucket?.some(
      (roof) =>
        h <= roof.height + ROOF_REACH_M && wellInside(roof, x, y, ROOF_INSET_M)
    );
  });
}
