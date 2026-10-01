/**
 * A tile's committed sources for what the fine terrain carries — kerb lines,
 * walls, fences, gates, stairs and terraces — read from `data/` as the
 * terrain bake (prepare-data.ts) and the ground-join check
 * (ground-joins.test.ts) both need them. Reads files, no side effects.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  GateFeature,
  KerbFeature,
  StairFeature,
  TerraceFeature,
  WallFileFeature,
} from "../lib/city/features";
import type { FenceLine, FenceType, GatePoint } from "../lib/city/fences";
import type { Point2 } from "../lib/city/polyline";
import {
  type StairLine,
  stairLineOf,
  type Terrace,
  terraceOf,
} from "../lib/city/stairs";
import type { WallLine } from "../lib/city/terrain-conflate";
import {
  kerbSourceFile,
  stairSourceFile,
  terraceSourceFile,
  wallSourceFile,
} from "../lib/city/tile";
import type { WallRibbon } from "../lib/city/walls";

const at = (path: string) => join(process.cwd(), path);
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

/** The tile's kerb lines (the smoothed DLM road edge), for the kerb stones
 *  the fine level carries. */
export function kerbLines(tile: string): Point2[][] {
  const path = at(kerbSourceFile(tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: KerbFeature[] }>(path);
  return features.flatMap((f) =>
    f.geometry?.type === "LineString" ? [f.geometry.coordinates] : []
  );
}

/** Everything the tile's walls file carries: walls, fences, gates. */
export function wallFile(tile: string): WallFileFeature[] {
  const path = at(wallSourceFile(tile));
  return existsSync(path)
    ? readJson<{ features: WallFileFeature[] }>(path).features
    : [];
}

/** The tile's OSM walls: the lines the terrain conflation burns in, and the
 *  ribbons the fine level carries. Not the fences: they never shape the
 *  ground. */
export function wallLines(tile: string): (WallLine & WallRibbon)[] {
  return wallFile(tile).flatMap((f) =>
    f.geometry?.type === "LineString" && f.properties?.kind !== "fence"
      ? [
          {
            coords: f.geometry.coordinates,
            kind: f.properties?.kind ?? "wall",
            h: (f.properties as { h?: number } | null)?.h ?? 2,
          },
        ]
      : []
  );
}

const FENCE_TYPES = new Set<FenceType>(["mesh", "picket", "rail", "railing"]);

/** The tile's OSM fences and railings, standing on their lines. */
export function fenceLines(tile: string): FenceLine[] {
  return wallFile(tile).flatMap((f) => {
    if (f.geometry?.type !== "LineString" || f.properties?.kind !== "fence") {
      return [];
    }
    const p = f.properties as { h?: number; type?: string };
    const type = FENCE_TYPES.has(p.type as FenceType)
      ? (p.type as FenceType)
      : "railing";
    return [{ coords: f.geometry.coordinates, h: p.h ?? 1.2, type }];
  });
}

/** The gates on the tile's wall and fence lines (a neighbour's too, where
 *  its gap reaches over the seam). */
export function gatePoints(tile: string): GatePoint[] {
  const isGate = (f: WallFileFeature): f is GateFeature =>
    f.geometry?.type === "Point" && f.properties?.kind === "gate";
  return wallFile(tile)
    .filter(isGate)
    .flatMap((f) =>
      f.properties
        ? [
            {
              at: f.geometry.coordinates,
              on: f.properties.on,
              w: f.properties.w,
              ...(f.properties.type ? { type: f.properties.type } : {}),
              ...(f.properties.seam ? { seam: true } : {}),
            },
          ]
        : []
    );
}

/** The tile's OSM stairs: the terrain bake shapes the ground under them and
 *  writes them into the fine level's glTF. */
export function stairLines(tile: string): StairLine[] {
  const path = at(stairSourceFile(tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: StairFeature[] }>(path);
  return features.flatMap((f) => stairLineOf(f) ?? []);
}

/** The raised areas the terrain bake lifts to their level. */
export function terraces(tile: string): Terrace[] {
  const path = at(terraceSourceFile(tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: TerraceFeature[] }>(path);
  return features.flatMap((f) => terraceOf(f) ?? []);
}
