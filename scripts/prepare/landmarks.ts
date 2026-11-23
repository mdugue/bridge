/**
 * A tile's landmark file, for the buildings (their flags) and the stats
 * (their count). Walked into both keys: the file is an input of each, and
 * this module is how they read it.
 */
import { existsSync } from "node:fs";
import { parseBakeFile } from "../../lib/city/bake-file";
import { LANDMARKS_FILE } from "../../lib/city/landmarks-file";
import type { LandmarkFile } from "../../lib/city/landmarks-file";
import { cityMeshSourceFiles } from "../../lib/city/tile";
import { SITE, at, readJson } from "./context";

/** A tile's landmarks (pipeline/bake/landmarks.py), or none; a file its
 *  schema refuses ends the build (ADR 0059). */
export function landmarkFile(tile: string): LandmarkFile | undefined {
  const path = at(cityMeshSourceFiles(SITE, tile).landmarks);
  return existsSync(path)
    ? parseBakeFile(LANDMARKS_FILE, readJson(path), path)
    : undefined;
}
