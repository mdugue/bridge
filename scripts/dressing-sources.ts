/**
 * The build's readers of the bake files a tile's dressing is made from
 * (plan 090): one reader a kind, each through the kind's one schema
 * (`parseBakeFile`, ADR 0059). Every baker of the dressing
 * (scripts/bake-dressing.ts) reads through here and nothing else opens
 * these files for it, so the bakes' format changes in this one place
 * (plan 092). An absent file is a kind the tile lacks: no features.
 */
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { parseBakeFile } from "../lib/city/bake-file";
import type { BakeFile } from "../lib/city/bake-file";
import { CANOPY_FILE } from "../lib/city/canopy-file";
import { CULTIVATED_FILE } from "../lib/city/cultivated-file";
import type {
  CanopyExtraFeature,
  CanopyFeature,
  CultivatedFeature,
  MonumentFeature,
  SmallBuildingFeature,
  TreeFeature,
  VegRowFeature,
} from "../lib/city/features";
import { MONUMENTS_FILE } from "../lib/city/monuments-file";
import { gapRoofs, lod2Roofs } from "../lib/city/roof-trees";
import type { RoofFootprint } from "../lib/city/roof-trees";
import { SCAN_CROWNS_FILE } from "../lib/city/scan-crowns-file";
import type { Site } from "../lib/city/site";
import { SMALL_BUILDINGS_FILE } from "../lib/city/small-buildings-file";
import { STRUCTURES_FILE } from "../lib/city/structures-file";
import {
  cityMeshSourceFiles,
  sideFileSource,
  tileArtifacts,
} from "../lib/city/tile";
import { TREES_FILE } from "../lib/city/trees-file";
import type { CityJsonDocument } from "../lib/city/types";
import { VEG_ROWS_FILE } from "../lib/city/veg-rows-file";
import type { z } from "zod";

/** The side files the trees are made from, by kind. */
const TREE_SIDE_KINDS = [
  "canopy",
  "canopyx",
  "trees",
  "vegrows",
  "cultivated",
  "monuments",
  "ndvi",
] as const;
type TreeSideKind = (typeof TREE_SIDE_KINDS)[number];

/** Where a tile's tree sources lie under `root`: the side files and the
 *  buildings' sources whose roofs and sheds take canopy points away. */
export function treeSourcePaths(
  site: Site,
  tile: string,
  root: string
): Record<TreeSideKind | "city" | "sheds" | "structures", string> {
  const artifacts = tileArtifacts(tile);
  const city = cityMeshSourceFiles(site, tile);
  const side = (kind: TreeSideKind) =>
    nodePath.join(root, sideFileSource(site, artifacts[kind].file));
  return {
    canopy: side("canopy"),
    canopyx: side("canopyx"),
    trees: side("trees"),
    vegrows: side("vegrows"),
    cultivated: side("cultivated"),
    monuments: side("monuments"),
    ndvi: side("ndvi"),
    city: nodePath.join(root, city.city),
    sheds: nodePath.join(root, city.smallBuild),
    structures: nodePath.join(root, city.structures),
  };
}

/** `path` parsed by `spec`, or null where the tile has no such file. */
function read<S extends z.ZodType>(
  spec: BakeFile<S>,
  path: string
): z.infer<S> | null {
  if (!existsSync(path)) {
    return null;
  }
  return parseBakeFile(spec, JSON.parse(readFileSync(path, "utf-8")), path);
}

/** The surface model's crowns, and whether the bake stood the tile's
 *  mapped tree rows' trees among them (its `rows` member). */
export function readCanopy(path: string): {
  features: CanopyFeature[];
  rowsMeasured: boolean;
} {
  const doc = read(CANOPY_FILE, path);
  return {
    features: doc?.features ?? [],
    rowsMeasured: doc?.rows !== undefined,
  };
}

/** The laser scan's crowns outside the canopy mask. */
export const readScanCrowns = (path: string): CanopyExtraFeature[] =>
  read(SCAN_CROWNS_FILE, path)?.features ?? [];

/** The surveyed trees (a register's, OSM's). */
export const readTrees = (path: string): TreeFeature[] =>
  read(TREES_FILE, path)?.features ?? [];

/** The mapped tree rows and hedges. */
export const readVegRows = (path: string): VegRowFeature[] =>
  read(VEG_ROWS_FILE, path)?.features ?? [];

/** Colonies, orchards and their trees, vineyards and their rows. */
export const readCultivated = (path: string): CultivatedFeature[] =>
  read(CULTIVATED_FILE, path)?.features ?? [];

export const readMonuments = (path: string): MonumentFeature[] =>
  read(MONUMENTS_FILE, path)?.features ?? [];

/** The scan's sheds: a canopy point in one is no tree. */
export const readSheds = (path: string): SmallBuildingFeature[] =>
  read(SMALL_BUILDINGS_FILE, path)?.features ?? [];

/** The tile's roofs, LoD2's and those of the buildings and roofs on posts
 *  it lacks: a canopy point on one is no tree. */
export function readRoofs(city: string, structures: string): RoofFootprint[] {
  return [
    ...(existsSync(city)
      ? lod2Roofs(JSON.parse(readFileSync(city, "utf-8")) as CityJsonDocument)
      : []),
    ...gapRoofs(read(STRUCTURES_FILE, structures)?.features ?? []),
  ];
}
