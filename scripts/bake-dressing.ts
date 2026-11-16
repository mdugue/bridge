/**
 * A tile's dressing files (lib/city/dressing-pack.ts; plan 090, phase 1):
 * the build stands every tree of the tile on the fine level's own ground —
 * the surface model's crowns and the scan's without those on a roof, in a
 * shed, on a monument or where a surveyed tree stands, the mapped rows no
 * surface model measured, the register's trees and the orchards' — and
 * writes each as the record the viewer makes its instance from
 * (lib/city/tree-table.ts), the ground's height and slope and the
 * orthophoto's greenness there baked in. The third of them the coarse
 * level draws (lib/city/coarse-crowns.ts `drawnCoarse`) go into that
 * level's file, the rest into the fine level's, which reads both. Run by
 * scripts/prepare/dressing.ts.
 *
 * A record says where a tree stands and what was measured of it, never
 * how it looks: this module and what it imports reach no colour, season
 * or style (bake-dressing.test.ts walks the imports).
 */
import { existsSync, readFileSync } from "node:fs";
import { drawnCoarse } from "../lib/city/coarse-crowns";
import { orchardTrees } from "../lib/city/cultivated";
import { emptyPack, packDressing } from "../lib/city/dressing-pack";
import type {
  DressingPack,
  PackRun,
  PackSection,
} from "../lib/city/dressing-pack";
import type {
  CanopyExtraFeature,
  CanopyFeature,
  TreeFeature,
} from "../lib/city/features";
import { groundSlope, worldToEpsg } from "../lib/city/ground-clamp";
import type { RecenterOffset } from "../lib/city/ground-clamp";
import { decodeGreyPng } from "../lib/city/png-raster";
import { maxWindowSampler } from "../lib/city/raster-sampler";
import type { RasterSampler } from "../lib/city/raster-sampler";
import { treesOffRoofs } from "../lib/city/roof-trees";
import type { Site } from "../lib/city/site";
import { treesOffStructures } from "../lib/city/small-buildings";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { inventoryCovers, inventoryTree } from "../lib/city/tree-inventory";
import {
  BASE_TREE_H,
  canopyFacts,
  canopyPlacement,
  CHUNK_SIZE,
  GENERIC_CROWN_W,
  offMonuments,
  plantedRows,
  rowPlacements,
} from "../lib/city/tree-placement";
import {
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
import {
  readCanopy,
  readCultivated,
  readMonuments,
  readRoofs,
  readScanCrowns,
  readSheds,
  readTrees,
  readVegRows,
  treeSourcePaths,
} from "./dressing-sources";

/** The fine level's ground the trees stand on. */
export interface DressingGround {
  /** the fine level's extent (the NDVI raster's) */
  bounds: TerrainBounds;
  heightAt: (x: number, y: number) => number | null;
  offset: RecenterOffset;
  /** the tile's south-west corner: the files' corner */
  origin: readonly [number, number];
}

/** A tree to write: where it stands in the viewer's frame (its chunk, the
 *  level that holds it, its run's box) and its record. */
interface Standing<F> {
  fact: F;
  /** its top over the ground and half its crown's width (m) */
  reach: readonly [number, number];
  x: number;
  y: number;
  z: number;
}

/**
 * A canopy file's points as the viewer read them before: off the sheds and
 * the roofs, their coordinates the float32 offsets from the tile's corner
 * the packed canopy held (lib/city/point-pack.ts) — a record's decimetres
 * give the same float back (lib/city/tree-table.ts `treeAt`), so every
 * tree keeps the turn and the size its coordinates seed.
 */
function thinned<F extends CanopyFeature>(
  features: readonly F[],
  sheds: ReturnType<typeof readSheds>,
  roofs: ReturnType<typeof readRoofs>,
  origin: readonly [number, number]
): F[] {
  const offSheds =
    sheds.length > 0 ? treesOffStructures(features, sheds) : features;
  const kept = roofs.length > 0 ? treesOffRoofs(offSheds, roofs) : offSheds;
  return kept.map((f) => {
    const [x, y] = f.geometry.coordinates;
    return {
      ...f,
      geometry: {
        type: "Point" as const,
        coordinates: [
          origin[0] + Math.fround(x - origin[0]),
          origin[1] + Math.fround(y - origin[1]),
        ] as [number, number],
      },
    };
  });
}

async function ndviSampler(
  path: string,
  bounds: TerrainBounds
): Promise<RasterSampler | undefined> {
  if (!existsSync(path)) {
    return undefined;
  }
  return maxWindowSampler(
    await decodeGreyPng(new Uint8Array(readFileSync(path))),
    bounds
  );
}

/** A tile's trees, each on its ground. */
export interface TileTrees {
  /** the canopy's, the scan's and the rows' */
  trees: Standing<TreeFact>[];
  /** the surveyed ones and the orchards', in their file's order */
  register: Standing<RegisterFact>[];
}

/** Every tree of `tile`, stood on `ground`. */
export async function standTrees(
  site: Site,
  tile: string,
  root: string,
  ground: DressingGround
): Promise<TileTrees> {
  const paths = treeSourcePaths(site, tile, root);
  const sheds = readSheds(paths.sheds);
  const roofs = readRoofs(paths.city, paths.structures);
  const canopy = readCanopy(paths.canopy);
  const monuments = readMonuments(paths.monuments);
  const surveyed: TreeFeature[] = [
    ...readTrees(paths.trees),
    ...orchardTrees(readCultivated(paths.cultivated)),
  ];
  const covers = inventoryCovers(surveyed);
  const keepTree = (x: number, y: number, h?: number) => !covers(x, y, h);
  const ndviAt = await ndviSampler(paths.ndvi, ground.bounds);
  const ctx = { heightAt: ground.heightAt, offset: ground.offset };
  const slopeAt = (x: number, z: number) => groundSlope(ctx, x, z);

  const trees: Standing<TreeFact>[] = [];
  const measured = (
    features: readonly (CanopyFeature | CanopyExtraFeature)[]
  ): void => {
    for (const f of offMonuments([...features], monuments)) {
      const [e, n] = f.geometry.coordinates;
      if (!keepTree(e, n, f.properties?.h)) {
        continue; // a surveyed tree stands here
      }
      const at = ground.heightAt(e, n);
      if (at === null) {
        continue;
      }
      const facts = canopyFacts(f);
      const ndvi = ndviAt?.(e, n);
      const p = canopyPlacement(e, n, at, facts, ground.offset, ndvi);
      trees.push({
        x: p.x,
        y: at,
        z: p.z,
        reach: [p.s * BASE_TREE_H, ((p.w ?? p.s) * GENERIC_CROWN_W) / 2],
        fact: {
          ...facts,
          e,
          n,
          ground: at,
          ndvi,
          slope: slopeAt(p.x, p.z),
          photo: f.properties?.ls === "dop",
        },
      });
    }
  };
  measured(thinned(canopy.features, sheds, roofs, ground.origin));
  measured(thinned(readScanCrowns(paths.canopyx), sheds, roofs, ground.origin));
  // the mapped rows where no surface model measured the tile: with one,
  // the canopy holds their trees and only the hedges are left of the rows
  const rows = rowPlacements(
    plantedRows(readVegRows(paths.vegrows), canopy.rowsMeasured),
    ctx,
    ndviAt,
    keepTree
  );
  for (const p of rows.trees) {
    const { x: e, y: n } = worldToEpsg(p.x, p.z, ground.offset);
    trees.push({
      x: p.x,
      y: p.y,
      z: p.z,
      reach: [p.s * BASE_TREE_H, ((p.w ?? p.s) * GENERIC_CROWN_W) / 2],
      fact: {
        h: Number.NaN,
        e,
        n,
        ground: p.y,
        ndvi: p.ndvi,
        slope: slopeAt(p.x, p.z),
        row: { rot: p.rot, s: p.s },
      },
    });
  }

  const register: Standing<RegisterFact>[] = [];
  for (const [index, f] of surveyed.entries()) {
    if (!f.properties) {
      continue;
    }
    const [e, n] = f.geometry.coordinates;
    const at = ground.heightAt(e, n);
    if (at === null) {
      continue;
    }
    const ndvi = ndviAt?.(e, n);
    // (the year moves a tree's age, never where or how tall it stands)
    const t = inventoryTree(e, n, at, f.properties, ground.offset, ndvi, 0);
    register.push({
      x: t.x,
      y: at,
      z: t.z,
      reach: [t.ext.crownTop, t.ext.crownWidth / 2],
      fact: {
        e,
        n,
        ground: at,
        ndvi,
        slope: slopeAt(t.x, t.z),
        index,
        props: f.properties,
      },
    });
  }
  return { trees, register };
}

/** `items` as a section sorted by vegetation chunk, a run a chunk. */
function section<F>(
  items: readonly Standing<F>[],
  words: number,
  write: (out: Uint16Array, index: number, fact: F) => void
): PackSection {
  const chunks = new Map<string, Standing<F>[]>();
  for (const item of items) {
    const cx = Math.floor(item.x / CHUNK_SIZE);
    const cz = Math.floor(item.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = chunks.get(key);
    if (chunk) {
      chunk.push(item);
    } else {
      chunks.set(key, [item]);
    }
  }
  const out = new Uint16Array(items.length * words);
  const runs: PackRun[] = [];
  let start = 0;
  const ordered = [...chunks.entries()].toSorted(([a], [b]) =>
    a < b ? -1 : 1
  );
  for (const [key, chunk] of ordered) {
    const [cx, cz] = key.split(",").map(Number);
    const box: [number, number, number, number, number, number] = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    let reach = 0;
    for (const [i, item] of chunk.entries()) {
      write(out, start + i, item.fact);
      box[0] = Math.min(box[0], item.x);
      box[1] = Math.min(box[1], item.y);
      box[2] = Math.min(box[2], item.z);
      box[3] = Math.max(box[3], item.x);
      box[4] = Math.max(box[4], item.y + item.reach[0]);
      box[5] = Math.max(box[5], item.z);
      reach = Math.max(reach, item.reach[1]);
    }
    runs.push({ cx, cz, group: 0, start, count: chunk.length, box, reach });
    start += chunk.length;
  }
  return { runs, words: out };
}

/** One level's pack of `trees`. */
function treePack(
  trees: TileTrees,
  origin: readonly [number, number, number],
  report: TreePackReport
): DressingPack {
  const pack = emptyPack(origin);
  pack.sections.trees = section(trees.trees, TREE_WORDS, (out, i, fact) =>
    writeTree(out, i, fact, origin, report)
  );
  // the surveyed trees in their file's order, each row a step from the
  // one before (lib/city/tree-table.ts): no runs, the viewer buckets them
  const words = new Uint16Array(trees.register.length * REGISTER_WORDS);
  let row = 0;
  for (const [i, { fact }] of trees.register.entries()) {
    writeRegister(words, i, fact, origin, report, row);
    row = fact.index;
  }
  pack.sections.register = { runs: [], words };
  return pack;
}

/**
 * The tile's two dressing files from its trees: the coarse level's holds
 * the third it draws, the fine level's the rest. A tree a record cannot
 * hold (outside the file's box, taller than its bits) fails the build.
 */
export function packTrees(
  trees: TileTrees,
  corner: readonly [number, number]
): { coarse: Uint8Array; fine: Uint8Array } {
  let lowest = Number.POSITIVE_INFINITY;
  for (const t of [...trees.trees, ...trees.register]) {
    lowest = Math.min(lowest, t.y);
  }
  const origin = [
    corner[0],
    corner[1],
    Number.isFinite(lowest) ? Math.floor(lowest) : 0,
  ] as const;
  const split = (coarse: boolean): TileTrees => ({
    trees: trees.trees.filter((t) => drawnCoarse(t.x, t.z) === coarse),
    register: trees.register.filter((t) => drawnCoarse(t.x, t.z) === coarse),
  });
  const report: TreePackReport = { clamped: 0 };
  const coarse = packDressing(treePack(split(true), origin, report));
  const fine = packDressing(treePack(split(false), origin, report));
  if (report.clamped > 0) {
    throw new Error(
      `dressing: ${report.clamped} fields of the trees' records do not fit (a tree outside the tile's box, a height or a width past 102 m, an index past 65 535)`
    );
  }
  return { coarse, fine };
}

/** The tile's two dressing files. */
export async function bakeDressing(
  site: Site,
  tile: string,
  root: string,
  ground: DressingGround
): Promise<{ coarse: Uint8Array; fine: Uint8Array }> {
  return packTrees(await standTrees(site, tile, root, ground), ground.origin);
}
