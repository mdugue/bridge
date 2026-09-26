/**
 * The small structures the laser scan saw and LoD2 lacks (sheds, garden
 * houses, container buildings; pipeline/bake/small_buildings.py) as closed
 * boxes for the city mesh: four walls, a flat or pent roof and a floor, as
 * flat non-indexed triangles wound counter-clockwise seen from outside (the
 * clay material draws front faces; the shadow pass draws back faces). The
 * bake appends them to a tile's buildings (scripts/bake-city-mesh.ts). No
 * THREE, no DOM.
 */
import type { SmallBuildingFeature } from "./features";

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
