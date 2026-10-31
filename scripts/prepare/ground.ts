/**
 * Each tile's fine ground for scripts/prepare-data.ts: its DGM shaped by
 * the walls, stairs, terraces, beds, passages and water lifts, cached as a
 * TIN (or a grid) the buildings, the fine level and the plate stand on, and
 * the heights read from it (bake-entries.ts `ground`).
 */
import { existsSync, readFileSync } from "node:fs";
import { tileExtentOf } from "../../lib/city/site";
import type { TerrainBounds } from "../../lib/city/terrain-geometry";
import {
  dgmSourceFiles,
  kerbSourceFile,
  stairSourceFile,
  terraceSourceFile,
  wallSourceFile,
} from "../../lib/city/tile";
import { ownsPoint, TERRAIN_LEVELS } from "../../lib/city/tileset";
import { BAKE_ENTRIES } from "../bake-entries";
import {
  type Dgm,
  fineTin,
  gridHeightAt,
  readDgm,
  shapeGrid,
  type TerrainFeatures,
  tinHeightAt,
} from "../bake-tiles";
import { FINE_TIN_MAX_ERROR } from "../bake-terrain-tin";
import {
  type FineGround,
  packGround,
  readGroundHeader,
  unpackGround,
} from "../ground-pack";
import {
  landcoverLegendFile,
  stairLines,
  terraces,
  wallLines,
  waterMember,
} from "../tile-sources";
import {
  decodeLift,
  type WaterLift,
  type WaterMember,
} from "../../lib/city/water-bodies";
import { SITE, TILES, at, cacheKey, cachedFile, log, since } from "./context";
import { bedsIn, passagesIn, shapedBy, underDeck } from "./lines";
import { offset } from "./frame";

/** The files a tile's shaped ground is baked from. */
export function terrainInputs(tile: string): string[] {
  const source = dgmSourceFiles(SITE, tile);
  return [
    at(source.tif),
    at(source.tfw),
    at(wallSourceFile(SITE, tile)),
    at(stairSourceFile(SITE, tile)),
    at(terraceSourceFile(SITE, tile)),
    at(kerbSourceFile(SITE, tile)),
    // its water's lifts (lib/city/water-bodies.ts)
    at(landcoverLegendFile(SITE, tile)),
  ];
}

/** A tile's DGM read at `size` (`"native"`: its own resolution). */
export async function tileDgm(
  tile: string,
  size: number | "native"
): Promise<Dgm> {
  const source = dgmSourceFiles(SITE, tile);
  const tfw = at(source.tfw);
  const buf = readFileSync(at(source.tif));
  return readDgm(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    existsSync(tfw) ? readFileSync(tfw, "utf8") : null,
    size
  );
}

/** A tile's water as its legend has it (lib/city/water-bodies.ts), read
 *  once; its lifts decoded once. */
const waterMembers = new Map<string, WaterMember | null>();
export function waterOf(tile: string): WaterMember | null {
  if (!waterMembers.has(tile)) {
    waterMembers.set(tile, waterMember(SITE, tile));
  }
  return waterMembers.get(tile) ?? null;
}
const waterLifts = new Map<string, Promise<WaterLift | null>>();
function waterLiftOf(tile: string): Promise<WaterLift | null> {
  let lift = waterLifts.get(tile);
  if (!lift) {
    const bounds = tileExtentOf(SITE.tiles[TILES.indexOf(tile)]);
    lift = decodeLift(waterOf(tile), bounds);
    waterLifts.set(tile, lift);
  }
  return lift;
}

/** What a tile's ground is shaped with besides its walls. */
export async function groundFeatures(tile: string): Promise<TerrainFeatures> {
  return {
    beds: bedsIn(tile),
    underDeck,
    passages: passagesIn(tile),
    stairs: stairLines(SITE, tile),
    terraces: terraces(SITE, tile),
    water: await waterLiftOf(tile),
  };
}

/** A tile's fine ground: a TIN over the native DGM (bake-terrain-tin.ts),
 *  unless the DGM has holes; then the grid. */
async function bakeFineGround(tile: string): Promise<FineGround> {
  const walls = wallLines(SITE, tile);
  const tin = fineTin(
    await tileDgm(tile, "native"),
    walls,
    await groundFeatures(tile),
    FINE_TIN_MAX_ERROR
  );
  if (tin) {
    return { kind: "tin", tin };
  }
  log(`${tile}: the DGM has NoData, the fine level stays a grid`);
  const dgm = await tileDgm(tile, TERRAIN_LEVELS[0].n);
  return {
    kind: "grid",
    grid: shapeGrid(dgm, walls, await groundFeatures(tile)),
  };
}

/**
 * Where a tile's fine ground lies in the cache (ground-pack.ts), baked first
 * when it is not there. Cached apart from the fine level's glTF, which
 * stands its walls, kerbs, stairs and fences on every tile's fine ground:
 * a process baking some of the site's tiles (prepare-sites.ts' warmers)
 * reads the others' grounds instead of refining their TINs again.
 */
const groundFiles = new Map<string, Promise<string>>();
export function groundFile(tile: string): Promise<string> {
  let file = groundFiles.get(tile);
  if (!file) {
    file = cachedFile(
      `ground_${tile}.bin`,
      cacheKey(
        terrainInputs(tile),
        BAKE_ENTRIES.ground,
        offset,
        shapedBy(tile)
      ),
      async () => {
        const t0 = performance.now();
        const packed = packGround(await bakeFineGround(tile));
        log(`ground ${tile}: built in ${since(t0)} ms`);
        return packed;
      }
    );
    groundFiles.set(tile, file);
  }
  return file;
}

/** Each tile's fine ground height, read from the cache when first asked
 *  for (the index over a TIN is ~10 MB, kept). */
export const heights = new Map<
  string,
  (x: number, y: number) => number | null
>();
export function heightOver(
  tile: string,
  path: string
): (x: number, y: number) => number | null {
  let heightAt = heights.get(tile);
  if (!heightAt) {
    const ground = unpackGround(readFileSync(path));
    heightAt =
      ground.kind === "tin"
        ? tinHeightAt(ground.tin)
        : gridHeightAt(ground.grid);
    heights.set(tile, heightAt);
  }
  return heightAt;
}

/** Ground height over the whole site: the fine, shaped ground of the tile
 *  holding the point — what the walker stands on at runtime. `tin` is true
 *  when every tile's fine level is a TIN (nothing burned to the wall line,
 *  so the walls snap to the measured step). Every tile's ground is cached
 *  first, one at a time; a tile's heights are read once a point asks. */
let groundTimed = false;
export async function siteGround(): Promise<{
  heightAt: (x: number, y: number) => number | null;
  tin: boolean;
}> {
  const t0 = performance.now();
  const fine: { bounds: TerrainBounds; path: string; tin: boolean }[] = [];
  for (const t of TILES) {
    const path = await groundFile(t);
    const { bounds, kind } = readGroundHeader(path);
    fine.push({ bounds, path, tin: kind === "tin" });
  }
  if (!groundTimed) {
    groundTimed = true;
    log(`site ground: ${since(t0)} ms`);
  }
  return {
    heightAt: (x, y) => {
      const i = fine.findIndex((g) => ownsPoint(g.bounds, x, y));
      return i < 0 ? null : heightOver(TILES[i], fine[i].path)(x, y);
    },
    tin: fine.every((g) => g.tin),
  };
}
