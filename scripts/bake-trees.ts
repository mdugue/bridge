/**
 * A tile's trees, placed (plan 090): every canopy, scan, row and surveyed
 * tree of its committed files stood on the fine level's own ground, as a
 * record of what was measured there (lib/city/tree-table.ts) — the third
 * the coarse level draws in that level's file, the rest in the fine
 * level's. Run by prepare/terrain.ts; published as the tile's `trees` and
 * `treesCoarse`.
 */
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { parseBakeFile } from "../lib/city/bake-file";
import { drawnCoarse } from "../lib/city/coarse-crowns";
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
import { groundSlope, worldToEpsg } from "../lib/city/ground-clamp";
import type { RecenterOffset } from "../lib/city/ground-clamp";
import { decodeGreyPng } from "../lib/city/png-raster";
import { maxWindowSampler } from "../lib/city/raster-sampler";
import type { RasterSampler } from "../lib/city/raster-sampler";
import { gapRoofs, lod2Roofs, treesOffRoofs } from "../lib/city/roof-trees";
import { SMALL_BUILDINGS_FILE } from "../lib/city/small-buildings-file";
import { STRUCTURES_FILE } from "../lib/city/structures-file";
import type { RoofFootprint } from "../lib/city/roof-trees";
import { treesOffStructures } from "../lib/city/small-buildings";
import type { Site } from "../lib/city/site";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import {
  cityMeshSourceFiles,
  sideFileSource,
  tileArtifacts,
} from "../lib/city/tile";
import type { TileArtifactKind } from "../lib/city/tile";
import type { CityJsonDocument } from "../lib/city/types";
import { inventoryCovers, inventoryTree } from "../lib/city/tree-inventory";
import {
  canopyFacts,
  canopyPlacement,
  offMonuments,
  plantedRows,
  rowPlacements,
} from "../lib/city/tree-placement";
import {
  packTreeFile,
  REGISTER_WORDS,
  TREE_WORDS,
  writeRegister,
  writeTree,
} from "../lib/city/tree-table";
import type {
  RegisterFact,
  TreeFact,
  TreePackReport,
} from "../lib/city/tree-table";

/** `tile`'s tree files under `root`, those it has. */
export function treeSources(site: Site, tile: string, root: string) {
  const have = (path: string) => {
    const full = nodePath.join(root, path);
    return existsSync(full) ? full : undefined;
  };
  const a = tileArtifacts(tile);
  const side = (kind: TileArtifactKind) =>
    have(sideFileSource(site, a[kind].file));
  const city = cityMeshSourceFiles(site, tile);
  return {
    canopy: side("canopy"),
    // the laser-scan crowns outside the canopy mask
    canopyx: side("canopyx"),
    cultivated: side("cultivated"),
    monuments: side("monuments"),
    ndvi: side("ndvi"),
    // canopy points on the LoD2 roofs, in the scan's sheds and on the
    // buildings LoD2 lacks are no trees
    city: have(city.city),
    sheds: have(city.smallBuild),
    structures: have(city.structures),
    trees: side("trees"),
    vegrows: side("vegrows"),
  };
}

/** Whether a canopy file holds its tile's tree rows' trees (canopy.py's
 *  `rows` member). */
function rowsMeasured(path: string | undefined): boolean {
  if (!(path && existsSync(path))) {
    return false;
  }
  const doc = JSON.parse(readFileSync(path, "utf-8")) as { rows?: unknown };
  return doc.rows !== undefined;
}

const readJsonFile = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf-8"));

function features<T>(path: string | undefined): T[] {
  if (!(path && existsSync(path))) {
    return [];
  }
  return (
    (JSON.parse(readFileSync(path, "utf-8")) as FeatureCollection<T>)
      .features ?? []
  );
}

/**
 * A canopy file's points off the sheds and the roofs, their coordinates
 * the float32 offsets from the tile's corner: a record's decimetres give
 * the same float back (`treeAt`), which seeds a tree's turn and size.
 */
function thinned(
  path: string | undefined,
  sheds: SmallBuildingFeature[],
  roofs: RoofFootprint[],
  origin: readonly [number, number]
): CanopyFeature[] {
  const raw = features<CanopyFeature>(path);
  const offSheds = sheds.length > 0 ? treesOffStructures(raw, sheds) : raw;
  const kept = roofs.length > 0 ? treesOffRoofs(offSheds, roofs) : offSheds;
  return kept.map((f) => ({
    ...f,
    geometry: {
      type: "Point" as const,
      coordinates: [
        origin[0] + Math.fround(f.geometry.coordinates[0] - origin[0]),
        origin[1] + Math.fround(f.geometry.coordinates[1] - origin[1]),
      ] as [number, number],
    },
  }));
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

/** A tree to write: where it stands in the viewer's frame, and its record. */
interface Stood<F> {
  fact: F;
  x: number;
  z: number;
}

/** The fine level's ground the trees stand on. */
export interface TreeGround {
  /** the fine level's extent (its NDVI sampler's bounds) */
  bounds: TerrainBounds;
  heightAt: (x: number, y: number) => number | null;
  offset: RecenterOffset;
  /** the tile's south-west corner: the files' corner */
  origin: readonly [number, number];
}

/** Every tree of the tile's files, stood on `ground`. */
export async function standTrees(
  sources: ReturnType<typeof treeSources>,
  ground: TreeGround
): Promise<{ register: Stood<RegisterFact>[]; trees: Stood<TreeFact>[] }> {
  const sheds =
    sources.sheds && existsSync(sources.sheds)
      ? parseBakeFile(
          SMALL_BUILDINGS_FILE,
          readJsonFile(sources.sheds),
          sources.sheds
        ).features
      : [];
  const roofs = [
    ...(sources.city && existsSync(sources.city)
      ? lod2Roofs(
          JSON.parse(readFileSync(sources.city, "utf-8")) as CityJsonDocument
        )
      : []),
    ...gapRoofs(
      sources.structures && existsSync(sources.structures)
        ? parseBakeFile(
            STRUCTURES_FILE,
            readJsonFile(sources.structures),
            sources.structures
          ).features
        : []
    ),
  ];
  const surveyed = [
    ...features<TreeFeature>(sources.trees),
    ...orchardTrees(features<CultivatedFeature>(sources.cultivated)),
  ];
  const covers = inventoryCovers(surveyed);
  const keepTree = (x: number, y: number, h?: number) => !covers(x, y, h);
  const ndviAt = await ndviSampler(sources.ndvi, ground.bounds);
  const ctx = { heightAt: ground.heightAt, offset: ground.offset };
  const trees: Stood<TreeFact>[] = [];
  const measured = offMonuments(
    [
      ...thinned(sources.canopy, sheds, roofs, ground.origin),
      ...thinned(sources.canopyx, sheds, roofs, ground.origin),
    ],
    features<MonumentFeature>(sources.monuments)
  );
  for (const f of measured) {
    const [e, n] = f.geometry.coordinates;
    const at = keepTree(e, n, f.properties?.h) ? ground.heightAt(e, n) : null;
    if (at === null) {
      continue; // a surveyed tree stands here, or no ground
    }
    const facts = canopyFacts(f);
    const ndvi = ndviAt?.(e, n);
    const { x, z } = canopyPlacement(e, n, at, facts, ground.offset, ndvi);
    trees.push({
      x,
      z,
      fact: {
        ...facts,
        e,
        n,
        ground: at,
        ndvi,
        slope: groundSlope(ctx, x, z),
        photo: f.properties?.ls === "dop",
      },
    });
  }
  // the mapped rows where no surface model measured the tile: with one,
  // the canopy holds their trees and only the hedges are left of the rows
  const rows = rowPlacements(
    plantedRows(
      features<VegRowFeature>(sources.vegrows),
      rowsMeasured(sources.canopy)
    ),
    ctx,
    ndviAt,
    keepTree
  );
  for (const p of rows.trees) {
    const { x: e, y: n } = worldToEpsg(p.x, p.z, ground.offset);
    trees.push({
      x: p.x,
      z: p.z,
      fact: {
        h: Number.NaN,
        e,
        n,
        ground: p.y,
        ndvi: p.ndvi,
        slope: groundSlope(ctx, p.x, p.z),
        row: { rot: p.rot, s: p.s },
      },
    });
  }
  const register: Stood<RegisterFact>[] = [];
  for (const [index, f] of surveyed.entries()) {
    const [e, n] = f.geometry.coordinates;
    const at = f.properties ? ground.heightAt(e, n) : null;
    if (at === null || !f.properties) {
      continue;
    }
    const ndvi = ndviAt?.(e, n);
    // (the year moves a tree's age, never where it stands)
    const t = inventoryTree(e, n, at, f.properties, ground.offset, ndvi, 0);
    register.push({
      x: t.x,
      z: t.z,
      fact: {
        e,
        n,
        ground: at,
        ndvi,
        slope: groundSlope(ctx, t.x, t.z),
        index,
        props: f.properties,
      },
    });
  }
  return { trees, register };
}

/** The 250 m square a tree stands in: neighbours on the ground are
 *  neighbours in the file, which is what gzip is given. */
const squareOf = (t: { x: number; z: number }): number =>
  Math.floor(t.x / 250) * 4096 + Math.floor(t.z / 250);

/**
 * The tile's two tree files: the coarse level's holds the third it draws,
 * the fine level's the rest. A tree a record cannot hold (outside the
 * file's box, taller than its bits) fails the build.
 */
export function packTrees(
  stood: Awaited<ReturnType<typeof standTrees>>,
  corner: readonly [number, number]
): { coarse: Uint8Array; fine: Uint8Array } {
  const lowest = Math.min(
    ...[...stood.trees, ...stood.register].map((t) => t.fact.ground)
  );
  const origin = [
    corner[0],
    corner[1],
    Number.isFinite(lowest) ? Math.floor(lowest) : 0,
  ] as const;
  const report: TreePackReport = { clamped: 0 };
  const level = (coarse: boolean): Uint8Array => {
    const mine = <F>(list: Stood<F>[]) =>
      list.filter((t) => drawnCoarse(t.x, t.z) === coarse);
    const canopy = mine(stood.trees).toSorted(
      (a, b) => squareOf(a) - squareOf(b)
    );
    const trees = new Uint16Array(canopy.length * TREE_WORDS);
    for (const [i, t] of canopy.entries()) {
      writeTree(trees, i, t.fact, origin, report);
    }
    // the surveyed trees in their file's order, each row a step from the
    // one before
    const surveyed = mine(stood.register);
    const register = new Uint16Array(surveyed.length * REGISTER_WORDS);
    let row = 0;
    for (const [i, { fact }] of surveyed.entries()) {
      writeRegister(register, i, fact, origin, report, row);
      row = fact.index;
    }
    return packTreeFile({ origin, trees, register });
  };
  const files = { coarse: level(true), fine: level(false) };
  if (report.clamped > 0) {
    throw new Error(
      `trees: ${report.clamped} fields of the records do not fit (a tree outside the tile's box, a height or a width past 102 m, a step between two rows past 65 535)`
    );
  }
  return files;
}
