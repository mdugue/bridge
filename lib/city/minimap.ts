/**
 * Pure mapping math for the schematic minimap. No THREE, no DOM.
 * The map is north-up: canvas y grows southward, EPSG y (northing) grows
 * northward.
 */

import type { TerrainBounds } from "./terrain-geometry";
import type { CityJsonDocument } from "./types";

/** Axis-aligned footprint rectangle in projected EPSG coordinates. */
export interface FootprintRect {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
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

/**
 * Extracts one rectangle per Building from `geographicalExtent`
 * ([minx, miny, minz, maxx, maxy, maxz]). BuildingParts are skipped — their
 * parent Building's extent already covers them.
 */
export function buildingFootprints(
  cityData: CityJsonDocument
): FootprintRect[] {
  const rects: FootprintRect[] = [];
  for (const obj of Object.values(cityData.CityObjects)) {
    if (obj.type !== "Building") {
      continue;
    }
    const extent = (obj as { geographicalExtent?: number[] })
      .geographicalExtent;
    if (!extent || extent.length < 6) {
      continue;
    }
    rects.push({
      minX: extent[0],
      minY: extent[1],
      maxX: extent[3],
      maxY: extent[4],
    });
  }
  return rects;
}
