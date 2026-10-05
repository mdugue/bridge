/**
 * A tile's coarse crowns (lib/city/coarse-crowns.ts) from its committed
 * tree files: the fine level's own placement — the same packed canopy the
 * browser unpacks, the same register veto, the same rows, on the fine
 * level's own ground — and the selection a small-scale Modell picture
 * keeps. Run by prepare-data.ts; the file it returns is published as the
 * tile's `crowns`.
 */
import { existsSync, readFileSync } from "node:fs";
import { coarseCrowns, packCrowns } from "../lib/city/coarse-crowns";
import { orchardTrees } from "../lib/city/cultivated";
import type {
  CanopyFeature,
  CultivatedFeature,
  FeatureCollection,
  MonumentFeature,
  SmallBuildingFeature,
  TreeFeature,
  VegRowFeature,
} from "../lib/city/features";
import type { RecenterOffset } from "../lib/city/ground-clamp";
import { decodeGreyPng } from "../lib/city/png-raster";
import {
  type PackedPoint,
  packPoints,
  pointFeatures,
  pointOf,
  unpackPoints,
} from "../lib/city/point-pack";
import {
  maxWindowSampler,
  type RasterSampler,
} from "../lib/city/raster-sampler";
import { treesOffStructures } from "../lib/city/small-buildings";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { inventoryCovers, inventoryTrees } from "../lib/city/tree-inventory";
import {
  canopyPlacements,
  offMonuments,
  rowPlacements,
} from "../lib/city/tree-placement";

/** The tile's tree files (absent ones are a layer off, as in the browser). */
export interface CrownSources {
  canopy?: string;
  /** the laser-scan crowns outside the canopy mask (stride 4) */
  canopyx?: string;
  cultivated?: string;
  monuments?: string;
  ndvi?: string;
  /** the scan's sheds: canopy points in them were dropped at publish */
  sheds?: string;
  trees?: string;
  vegrows?: string;
}

function features<T>(path: string | undefined): T[] {
  if (!(path && existsSync(path))) {
    return [];
  }
  return (
    (JSON.parse(readFileSync(path, "utf8")) as FeatureCollection<T>).features ??
    []
  );
}

/**
 * The canopy points as the browser reads them: the sheds' points dropped
 * and the rest packed against the tile's corner (prepare-data.ts
 * `publishCanopy`), then unpacked — each coordinate the same float.
 */
function packedCanopy(
  path: string | undefined,
  sheds: SmallBuildingFeature[],
  origin: [number, number],
  stride: 3 | 4
): CanopyFeature[] {
  const raw = features<CanopyFeature>(path);
  if (raw.length === 0) {
    return [];
  }
  const kept = sheds.length > 0 ? treesOffStructures(raw, sheds) : raw;
  const points: PackedPoint[] = kept.map(pointOf);
  // a fresh array over its own buffer
  const packed = packPoints(points, origin, stride).buffer as ArrayBuffer;
  const unpacked = unpackPoints(packed);
  return unpacked ? pointFeatures(unpacked) : [];
}

async function ndviSampler(
  path: string | undefined,
  bounds: TerrainBounds
): Promise<RasterSampler | undefined> {
  if (!(path && existsSync(path))) {
    return undefined;
  }
  return maxWindowSampler(
    await decodeGreyPng(new Uint8Array(readFileSync(path))),
    bounds
  );
}

export async function bakeCoarseCrowns(
  sources: CrownSources,
  ground: {
    /** the fine level's extent (its NDVI sampler's bounds) */
    bounds: TerrainBounds;
    heightAt: (x: number, y: number) => number | null;
    offset: RecenterOffset;
    /** the tile's south-west corner (the canopy pack's origin) */
    origin: [number, number];
  }
): Promise<Uint8Array> {
  const sheds = features<SmallBuildingFeature>(sources.sheds);
  const register = [
    ...features<TreeFeature>(sources.trees),
    ...orchardTrees(features<CultivatedFeature>(sources.cultivated)),
  ];
  const covers = inventoryCovers(register);
  const keepTree = (x: number, y: number, h?: number) => !covers(x, y, h);
  const ndviAt = await ndviSampler(sources.ndvi, ground.bounds);
  const ctx = { heightAt: ground.heightAt, offset: ground.offset };
  const canopy = offMonuments(
    [
      ...packedCanopy(sources.canopy, sheds, ground.origin, 3),
      ...packedCanopy(sources.canopyx, sheds, ground.origin, 4),
    ],
    features<MonumentFeature>(sources.monuments)
  );
  const rows = rowPlacements(
    features<VegRowFeature>(sources.vegrows),
    ctx,
    ndviAt,
    keepTree
  );
  const placements = [
    ...rows.trees,
    ...canopyPlacements(canopy, ctx, ndviAt, keepTree),
  ];
  return packCrowns(
    coarseCrowns(placements, inventoryTrees(register, ctx, ndviAt))
  );
}
