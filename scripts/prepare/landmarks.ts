/**
 * A tile's landmark file, for the buildings (their flags) and the stats
 * (their count). Walked into both keys: the file is an input of each, and
 * this module is how they read it.
 */
import { existsSync } from "node:fs";
import type { LandmarkFile } from "../../lib/city/landmarks";
import { cityMeshSourceFiles } from "../../lib/city/tile";
import { SITE, at, readJson } from "./context";

/** A tile's landmarks (pipeline/bake/landmarks.py), or none. */
export function landmarkFile(tile: string): LandmarkFile | undefined {
  const path = at(cityMeshSourceFiles(SITE, tile).landmarks);
  return existsSync(path) ? readJson<LandmarkFile>(path) : undefined;
}
