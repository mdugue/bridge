/**
 * The frame every tile of scripts/prepare-data.ts is recentered in: the
 * spawn tile's offset and CRS, cached with its CityJSON (bake-entries.ts
 * `frame`).
 */
import { existsSync } from "node:fs";
import { cityMeshSourceFiles } from "../../lib/city/tile";
import type { CityJsonDocument } from "../../lib/city/types";
import { type CityFrame, cityFrame } from "../bake-city-mesh";
import { BAKE_ENTRIES } from "../bake-entries";
import {
  HINT,
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  fail,
  parse,
  readJson,
  siteWide,
  utf8,
} from "./context";

/**
 * Every tile is recentered on one offset, the spawn tile's (the frame
 * snapshots are recorded in): its bake finds it as the loader parses it,
 * the rest take it from `cityFrame`, which reads the spawn tile's CityJSON
 * without parsing a building — once, when the frame or another tile's
 * buildings are baked.
 */
let spawn: CityFrame | null = null;

export function spawnFrame(): CityFrame {
  if (!spawn) {
    const src = cityMeshSourceFiles(SITE, TILES[0]);
    if (!existsSync(at(src.city))) {
      fail(`missing source file ${src.city}${HINT}`);
    }
    spawn = cityFrame(TILES[0], readJson<CityJsonDocument>(at(src.city)));
  }
  return spawn;
}

/** The shared offset and CRS, cached with the spawn tile's CityJSON. */
export const frame = parse<{ cx: number; cy: number; epsg: number }>(
  await cached(
    siteWide("frame.json"),
    cacheKey(
      [at(cityMeshSourceFiles(SITE, TILES[0]).city)],
      BAKE_ENTRIES.frame
    ),
    () => {
      const { offset, epsg } = spawnFrame();
      return utf8({ ...offset, epsg });
    }
  )
);
export const offset = { cx: frame.cx, cy: frame.cy };
