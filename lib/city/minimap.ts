/**
 * Pure mapping math for the schematic minimap. No THREE, no DOM.
 * The map is north-up: canvas y grows southward, EPSG y (northing) grows
 * northward.
 */

import type { TerrainBounds } from "./terrain-geometry";
import type { CityJsonDocument } from "./types";

/** A building footprint as a projected-EPSG polygon ring ([x, y] pairs). */
export interface FootprintPoly {
  pts: [number, number][];
}

/** Projected EPSG coordinates -> canvas pixels (north-up). */
export function epsgToMapPx(
  x: number,
  y: number,
  bounds: TerrainBounds,
  sizePx: number
): { px: number; py: number } {
  const [minX, minY, maxX, maxY] = bounds;
  return {
    px: ((x - minX) / (maxX - minX)) * sizePx,
    py: ((maxY - y) / (maxY - minY)) * sizePx,
  };
}

/** Canvas pixels -> projected EPSG coordinates. */
export function mapPxToEpsg(
  px: number,
  py: number,
  bounds: TerrainBounds,
  sizePx: number
): { x: number; y: number } {
  const [minX, minY, maxX, maxY] = bounds;
  return {
    x: minX + (px / sizePx) * (maxX - minX),
    y: maxY - (py / sizePx) * (maxY - minY),
  };
}

// --- true footprint polygons (from GroundSurface semantics) ----------------

interface SemanticGeometry {
  boundaries: unknown;
  semantics?: { surfaces: { type?: string }[]; values: unknown };
  type?: string;
}

/** Exterior ring (first ring) of a face -> projected [x, y] points. */
function ringToPoly(
  ring: number[],
  vertices: [number, number, number][],
  scale: [number, number, number],
  translate: [number, number, number]
): [number, number][] {
  const pts: [number, number][] = [];
  for (const idx of ring) {
    const v = vertices[idx];
    if (v) {
      pts.push([
        v[0] * scale[0] + translate[0],
        v[1] * scale[1] + translate[1],
      ]);
    }
  }
  return pts;
}

/**
 * Pulls every GroundSurface face out of one geometry (Solid or MultiSurface)
 * and returns its exterior ring as a projected polygon. Empty when the
 * geometry carries no GroundSurface semantics.
 */
function groundPolysFromGeometry(
  geom: SemanticGeometry,
  vertices: [number, number, number][],
  scale: [number, number, number],
  translate: [number, number, number]
): FootprintPoly[] {
  const sem = geom.semantics;
  if (!sem) {
    return [];
  }
  const isGround = (i: number) => sem.surfaces[i]?.type === "GroundSurface";
  const polys: FootprintPoly[] = [];
  // Solid: boundaries[shell][face][ring][idx], values[shell][face].
  // MultiSurface: boundaries[face][ring][idx], values[face].
  const shells =
    geom.type === "Solid"
      ? (geom.boundaries as number[][][][])
      : [geom.boundaries as number[][][]];
  const values =
    geom.type === "Solid"
      ? (sem.values as (number | null)[][])
      : [sem.values as (number | null)[]];
  shells.forEach((faces, shellIdx) => {
    const shellValues = values[shellIdx] ?? [];
    faces.forEach((face, faceIdx) => {
      const surfaceId = shellValues[faceIdx];
      if (surfaceId == null || !isGround(surfaceId)) {
        return;
      }
      const ring = face[0];
      if (ring?.length >= 3) {
        polys.push({ pts: ringToPoly(ring, vertices, scale, translate) });
      }
    });
  });
  return polys;
}

/**
 * True building footprints: the GroundSurface polygons of every Building /
 * BuildingPart, projected to EPSG. Falls back to a Building's bbox rectangle
 * when its geometry carries no ground semantics, so coverage never regresses.
 * Drawn (not filled bbox) the minimap reads as an accurate figure-ground plan
 * instead of a few oversized dark rectangles.
 */
export function buildingFootprintPolys(
  cityData: CityJsonDocument
): FootprintPoly[] {
  const scale = cityData.transform?.scale ?? [1, 1, 1];
  const translate = cityData.transform?.translate ?? [0, 0, 0];
  const vertices = cityData.vertices;
  const polys: FootprintPoly[] = [];
  for (const obj of Object.values(cityData.CityObjects)) {
    if (obj.type !== "Building" && obj.type !== "BuildingPart") {
      continue;
    }
    let found = 0;
    for (const g of (obj.geometry ?? []) as SemanticGeometry[]) {
      for (const poly of groundPolysFromGeometry(
        g,
        vertices,
        scale,
        translate
      )) {
        polys.push(poly);
        found++;
      }
    }
    const extent = (obj as { geographicalExtent?: number[] })
      .geographicalExtent;
    if (
      found === 0 &&
      obj.type === "Building" &&
      extent &&
      extent.length >= 6
    ) {
      polys.push({
        pts: [
          [extent[0], extent[1]],
          [extent[3], extent[1]],
          [extent[3], extent[4]],
          [extent[0], extent[4]],
        ],
      });
    }
  }
  return polys;
}
