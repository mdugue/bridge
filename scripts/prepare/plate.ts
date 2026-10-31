/**
 * The ground plate of scripts/prepare-data.ts: the whole site's fine ground
 * at a coarse grid with its land cover (lib/city/ground-plate.ts). Its
 * bake's entries name this module (bake-entries.ts `plate`).
 */
import { existsSync, readFileSync } from "node:fs";
import {
  encodePlate,
  PLATE_N,
  plateClasses,
  plateHeights,
  shrinkClassRaster,
} from "../../lib/city/ground-plate";
import { decodeGreyPng } from "../../lib/city/png-raster";
import type { TerrainBounds } from "../../lib/city/terrain-geometry";
import { sideFileSource, tileArtifacts } from "../../lib/city/tile";
import type { BakedTile } from "../../lib/city/tileset";
import { BAKE_ENTRIES } from "../bake-entries";
import {
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  gz,
  publish,
  siteWide,
} from "./context";
import { siteShapes } from "./lines";
import { offset } from "./frame";
import { heights, siteGround, terrainInputs } from "./ground";

// --- the ground plate -----------------------------------------------------------
// The whole site's ground at a 62.5 m grid with its land cover, one small
// file the viewer draws under every tile that has no terrain on screen yet
// (lib/city/ground-plate.ts). Its heights are the site's fine ground,
// whose every point one tile owns: neighbours share their edge rows
// exactly, and the plate has no seams.

/** Whether two extents overlap or share an edge or a corner. */
function touches(a: TerrainBounds, b: TerrainBounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** The plate under the tiles `baked` (their bounds and elevation ranges as
 *  the tile loop found them), published. */
export async function bakePlate(baked: readonly BakedTile[]): Promise<string> {
  const rasters = baked.map((t) =>
    at(sideFileSource(SITE, tileArtifacts(t.id).landcover.file))
  );
  const inputs = [
    ...TILES.flatMap(terrainInputs),
    ...rasters.filter((path) => existsSync(path)),
  ];
  const bounds = baked.map((t) => t.bounds);
  const name = "plate.bin.gz";
  const floor = Math.min(...baked.map((t) => t.zRange[0]));
  const bytes = await cached(
    siteWide(name),
    cacheKey(
      inputs,
      BAKE_ENTRIES.plate,
      offset,
      siteShapes,
      bounds,
      floor,
      PLATE_N
    ),
    async () => {
      const ground = await siteGround();
      // the site's east and north edges are no tile's (`ownsPoint`)
      const near = (x: number, y: number) =>
        ground.heightAt(x, y) ??
        ground.heightAt(x - 0.5, y) ??
        ground.heightAt(x, y - 0.5) ??
        ground.heightAt(x - 0.5, y - 0.5);
      // every tile's classes, cut to 512² (≈ 4 m a texel, 16² of them to
      // a plate cell; 256 kB a tile), so a vertex's window reads across
      // the tile edges
      const classRasters = [];
      for (const [k, t] of baked.entries()) {
        if (existsSync(rasters[k])) {
          const r = await decodeGreyPng(readFileSync(rasters[k]));
          classRasters.push(
            shrinkClassRaster({ ...r, bounds: t.bounds }, r.width / 512)
          );
        }
      }
      // the grounds this step reads stay only while a tile still to come
      // reads them (its own, and its neighbours' edge rows): a cold build
      // of a large site would otherwise hold every tile's, and dropping
      // each after its tile decoded the same neighbour up to four times
      // (the tile loop's own stay as they were)
      const held = new Set(heights.keys());
      const boundsOf = new Map(baked.map((t) => [t.id, t.bounds]));
      const tiles = [];
      for (const [k, t] of baked.entries()) {
        const touching = classRasters.filter((r) =>
          touches(r.bounds, t.bounds)
        );
        tiles.push({
          heights: plateHeights(t.bounds, near, floor),
          classes: plateClasses(t.bounds, touching),
        });
        const later = baked.slice(k + 1);
        for (const id of heights.keys()) {
          const b = boundsOf.get(id);
          if (
            !held.has(id) &&
            !(b && later.some((next) => touches(b, next.bounds)))
          ) {
            heights.delete(id);
          }
        }
      }
      return gz(encodePlate(tiles));
    }
  );
  return publish(name, bytes);
}
