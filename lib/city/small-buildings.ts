/**
 * The small structures the laser scan saw and LoD2 lacks (sheds, garden
 * houses, container buildings; pipeline/bake/small_buildings.py) as closed
 * boxes for the city mesh: four walls, a flat or pent roof and a floor, as
 * flat non-indexed triangles wound counter-clockwise seen from outside (the
 * clay material draws front faces; the shadow pass draws back faces). The
 * bake appends them to a tile's buildings (scripts/bake-city-mesh.ts). No
 * THREE, no DOM.
 */
import type { PointGeometry, SmallBuildingFeature } from "./features";

/** Metres the box reaches below its lowest ground, so a slope shows no gap. */
export const SMALL_BUILDING_SINK = 0.2;

/** One structure's triangles in the recentered data frame (Z-up). */
export interface StructureMesh {
  /** 1 on roof vertices, 0 elsewhere */
  isRoof: number[];
  /** x, y, z per vertex */
  positions: number[];
}

/** The ring's four corners with their roof heights above `z`, counter-
 *  clockwise seen from above (the bake writes shapely's order). */
export function structureCorners(
  f: SmallBuildingFeature
): { h: number; x: number; y: number }[] | null {
  const ring = f.geometry.coordinates[0];
  const p = f.properties;
  if (!p || ring === undefined || ring.length < 4) {
    return null;
  }
  const corners = ring.slice(0, 4).map(([x, y], i) => ({
    h: p.hc?.[i] ?? p.h,
    x,
    y,
  }));
  let area = 0;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  });
  return area < 0 ? corners.reverse() : corners;
}

/**
 * The box of one structure, `offset` subtracted from x and y (the tileset's
 * recenter offset). Empty when the feature is malformed.
 */
export function structureMesh(
  f: SmallBuildingFeature,
  offset: { cx: number; cy: number }
): StructureMesh {
  const out: StructureMesh = { isRoof: [], positions: [] };
  const corners = structureCorners(f);
  const z = f.properties?.z;
  if (!corners || z === undefined) {
    return out;
  }
  const base = z - SMALL_BUILDING_SINK;
  const low = corners.map((c) => [c.x - offset.cx, c.y - offset.cy, base]);
  const high = corners.map((c) => [c.x - offset.cx, c.y - offset.cy, z + c.h]);
  const tri = (roof: number, ...vs: number[][]) => {
    for (const v of vs) {
      out.positions.push(v[0], v[1], v[2]);
      out.isRoof.push(roof);
    }
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // a → b along a CCW ring: its outside is on the right
    tri(0, low[i], low[j], high[j]);
    tri(0, low[i], high[j], high[i]);
  }
  tri(1, high[0], high[1], high[2]);
  tri(1, high[0], high[2], high[3]);
  tri(0, low[0], low[2], low[1]);
  tri(0, low[0], low[3], low[2]);
  return out;
}

/**
 * Metres around a scan structure within which a canopy point is the
 * structure itself: DOM1 reads a shed's roof as a 3–4 m "tree" (859 canopy
 * points stood inside 636 sheds, 807 of them within 1 m of the shed's own
 * height), so the build drops them where it publishes the canopy
 * (scripts/prepare-data.ts). The canopy bake runs before the small
 * structures, so it cannot.
 */
export const STRUCTURE_TREE_CLEAR_M = 0.5;

const CELL = 16;

/** Squared distance from p to the segment a–b. */
function segmentDistance2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 > 0
      ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / len2, 0), 1)
      : 0;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Whether (x, y) lies in the convex ring or within `clear` of it. */
function nearRing(
  ring: readonly (readonly [number, number])[],
  x: number,
  y: number,
  clear: number
): boolean {
  let pos = 0;
  let neg = 0;
  let d2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % 4];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross >= 0) {
      pos++;
    }
    if (cross <= 0) {
      neg++;
    }
    d2 = Math.min(d2, segmentDistance2(x, y, ax, ay, bx, by));
  }
  return pos === 4 || neg === 4 || d2 <= clear * clear;
}

/**
 * The point features (canopy or laser-scan crowns) that stand neither in
 * a scan structure's rectangle nor within `clear` metres of it.
 */
export function treesOffStructures<F extends { geometry: PointGeometry }>(
  trees: readonly F[],
  structures: readonly SmallBuildingFeature[],
  clear = STRUCTURE_TREE_CLEAR_M
): F[] {
  const cells = new Map<string, (readonly [number, number])[][]>();
  for (const s of structures) {
    const ring = s.geometry.coordinates[0]?.slice(0, 4);
    if (!ring || ring.length < 4) {
      continue;
    }
    const xs = ring.map((c) => c[0]);
    const ys = ring.map((c) => c[1]);
    const c0 = Math.floor((Math.min(...xs) - clear) / CELL);
    const c1 = Math.floor((Math.max(...xs) + clear) / CELL);
    const r0 = Math.floor((Math.min(...ys) - clear) / CELL);
    const r1 = Math.floor((Math.max(...ys) + clear) / CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const key = `${cx},${cy}`;
        const bucket = cells.get(key);
        if (bucket) {
          bucket.push(ring);
        } else {
          cells.set(key, [ring]);
        }
      }
    }
  }
  return trees.filter((t) => {
    const [x, y] = t.geometry.coordinates;
    const bucket = cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
    return !bucket?.some((ring) => nearRing(ring, x, y, clear));
  });
}
