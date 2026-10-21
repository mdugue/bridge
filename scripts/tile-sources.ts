/**
 * A tile's committed sources for what the fine terrain carries — kerb lines,
 * walls, fences, gates, stairs and terraces — read from `data/<site>/` as the
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
import type { KerbLine } from "../lib/city/kerbs";
import {
  type StairLine,
  stairLineOf,
  type Terrace,
  terraceOf,
} from "../lib/city/stairs";
import type { WallLine } from "../lib/city/terrain-conflate";
import {
  kerbSourceFile,
  sideFileSource,
  stairSourceFile,
  terraceSourceFile,
  wallSourceFile,
} from "../lib/city/tile";
import type { WaterMember } from "../lib/city/water-bodies";
import { type Masonry, masonryOf, type WallRibbon } from "../lib/city/walls";
import type { Site } from "../lib/city/site";

const at = (path: string) => join(process.cwd(), path);
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

/** The tile's kerb lines (the smoothed DLM road edge) and where they are
 *  lowered, for the kerb stones the fine level carries. */
export function kerbLines(site: Site, tile: string): KerbLine[] {
  const path = at(kerbSourceFile(site, tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: KerbFeature[] }>(path);
  return features.flatMap((f) => {
    if (f.geometry?.type !== "LineString") {
      return [];
    }
    const low = (f.properties?.low ?? []).filter(
      (d) => d.length === 3 && d.every(Number.isFinite) && d[1] > d[0]
    );
    return [
      {
        coords: f.geometry.coordinates,
        ...(low.length > 0 ? { low } : {}),
      },
    ];
  });
}

/** Everything the tile's walls file carries: walls, fences, gates. */
export function wallFile(site: Site, tile: string): WallFileFeature[] {
  const path = at(wallSourceFile(site, tile));
  return existsSync(path)
    ? readJson<{ features: WallFileFeature[] }>(path).features
    : [];
}

/** The tile's OSM walls: the lines the terrain conflation burns in, and the
 *  ribbons the fine level carries. Not the fences: they never shape the
 *  ground. */
export function wallLines(site: Site, tile: string): (WallLine & WallRibbon)[] {
  return wallFile(site, tile).flatMap((f) =>
    f.geometry?.type === "LineString" && f.properties?.kind !== "fence"
      ? [
          {
            coords: f.geometry.coordinates,
            kind: f.properties?.kind ?? "wall",
            h: (f.properties as { h?: number } | null)?.h ?? 2,
            ...wallMaterial(f),
          },
        ]
      : []
  );
}

/** A wall feature's material (`mat`), where it names one. */
function wallMaterial(f: WallFileFeature): { mat?: Masonry } {
  const mat = masonryOf((f.properties as { mat?: unknown } | null)?.mat);
  return mat ? { mat } : {};
}

const FENCE_TYPES = new Set<FenceType>(["mesh", "picket", "rail", "railing"]);

/** The tile's OSM fences and railings, standing on their lines. */
export function fenceLines(site: Site, tile: string): FenceLine[] {
  return wallFile(site, tile).flatMap((f) => {
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
export function gatePoints(site: Site, tile: string): GatePoint[] {
  const isGate = (f: WallFileFeature): f is GateFeature =>
    f.geometry?.type === "Point" && f.properties?.kind === "gate";
  return wallFile(site, tile)
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
export function stairLines(site: Site, tile: string): StairLine[] {
  const path = at(stairSourceFile(site, tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: StairFeature[] }>(path);
  return features.flatMap((f) => stairLineOf(f) ?? []);
}

/** The tile's land-cover legend (pipeline/bake/landcover.py): a terrain
 *  bake input for its water — never served. */
export function landcoverLegendFile(site: Site, tile: string): string {
  return sideFileSource(site, `landcover_${tile}.json`);
}

/** The water's bodies the land-cover bake wrote into the tile's legend
 *  (lib/city/water-bodies.ts), or null where its legend has none yet. */
export function waterMember(site: Site, tile: string): WaterMember | null {
  const path = at(landcoverLegendFile(site, tile));
  if (!existsSync(path)) {
    return null;
  }
  return readJson<{ water?: WaterMember }>(path).water ?? null;
}

/** The raised areas the terrain bake lifts to their level. */
export function terraces(site: Site, tile: string): Terrace[] {
  const path = at(terraceSourceFile(site, tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: TerraceFeature[] }>(path);
  return features.flatMap((f) => terraceOf(f) ?? []);
}
