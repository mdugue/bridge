/**
 * Where every part baked into the fine terrain meets the ground, measured
 * over the committed tiles (ADR 0035): the kerb stones, the walls, the
 * flights of steps and the fences, built from the committed sources on the
 * shaped native DGM exactly as prepare-data.ts builds them on the TIN (which
 * stays within FINE_TIN_MAX_ERROR of it), each reporting its joins
 * (lib/city/ground-join.ts), each join checked against that ground.
 *
 * ground-joins.test.ts holds the share of misses per part to a budget, so a
 * part that starts floating or standing a step on the ground — a new layer
 * included, once its builder reports its joins and is listed here — fails
 * the unit tests instead of a look on a phone. Run directly for the table
 * and the worst places:
 *
 *   bun scripts/ground-joins.ts [tile …]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { doorJoins } from "../lib/city/doors";
import { plinthJoins } from "../lib/city/plinths";
import type {
  DoorFeature,
  PlinthFeature,
  SmallBuildingFeature,
} from "../lib/city/features";
import { cutWallGates, fenceGeometry } from "../lib/city/fences";
import {
  checkJoins,
  type HeightAt,
  type JoinPoint,
  type JoinReport,
} from "../lib/city/ground-join";
import { kerbGeometry } from "../lib/city/kerbs";
import { axisMiddle, stairGeometry } from "../lib/city/stairs";
import {
  sampleHeightfield,
  type TerrainBounds,
} from "../lib/city/terrain-geometry";
import { tileExtentOf, tileIdOf } from "../lib/city/site";
import { structureJoins } from "../lib/city/small-buildings";
import { cityMeshSourceFiles, dgmSourceFiles, tileIds } from "../lib/city/tile";
import { ownsPoint } from "../lib/city/tileset";
import { wallGeometry } from "../lib/city/walls";
import type { Site } from "../lib/city/site";
import { REFERENCE_SITE, SITES, siteFromArgs } from "../sites";
import { FINE_TIN_MAX_ERROR } from "./bake-terrain-tin";
import { readDgm, shapeDgm } from "./bake-tiles";
import {
  fenceLines,
  gatePoints,
  kerbLines,
  stairLines,
  terraces,
  wallLines,
} from "./tile-sources";

/** The parts measured, by the name the report uses. */
export const JOIN_PARTS = [
  "kerbs",
  "walls",
  "stairs",
  "fences",
  "sheds",
  "doors",
  "plinths",
] as const;
export type JoinPart = (typeof JOIN_PARTS)[number];

const OFFSET = { cx: 0, cy: 0 }; // joins are EPSG: the frame does not matter

interface Ground {
  bounds: TerrainBounds;
  heightAt: HeightAt;
}

/** A tile's fine ground: its native DGM, shaped as the TIN is shaped. */
async function tileGround(site: Site, tile: string): Promise<Ground> {
  const src = dgmSourceFiles(site, tile);
  const tif = readFileSync(join(process.cwd(), src.tif));
  const tfw = readFileSync(join(process.cwd(), src.tfw), "utf8");
  const dgm = await readDgm(
    tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength),
    tfw,
    "native"
  );
  const elevations = shapeDgm(
    dgm,
    wallLines(site, tile),
    { stairs: stairLines(site, tile), terraces: terraces(site, tile) },
    { burnWalls: false, stairMargin: FINE_TIN_MAX_ERROR }
  );
  const field = { elevations, n: dgm.n, bounds: dgm.bounds };
  return {
    bounds: dgm.bounds,
    heightAt: (x, y) => sampleHeightfield(field, x, y),
  };
}

/** The LoD2 walls' street side the bake draws as plinths. */
function plinths(site: Site, tile: string): PlinthFeature[] {
  const path = join(process.cwd(), cityMeshSourceFiles(site, tile).plinths);
  return existsSync(path)
    ? ((
        JSON.parse(readFileSync(path, "utf8")) as {
          features?: PlinthFeature[];
        }
      ).features ?? [])
    : [];
}

/** OSM's entrances the bake draws as doors on a tile's walls. */
function doors(site: Site, tile: string): DoorFeature[] {
  const path = join(process.cwd(), cityMeshSourceFiles(site, tile).doors);
  return existsSync(path)
    ? ((
        JSON.parse(readFileSync(path, "utf8")) as {
          features?: DoorFeature[];
        }
      ).features ?? [])
    : [];
}

/** The scan's small structures the bake appends to a tile's buildings. */
function smallBuildings(site: Site, tile: string): SmallBuildingFeature[] {
  const path = join(process.cwd(), cityMeshSourceFiles(site, tile).smallBuild);
  return existsSync(path)
    ? ((
        JSON.parse(readFileSync(path, "utf8")) as {
          features?: SmallBuildingFeature[];
        }
      ).features ?? [])
    : [];
}

/** The joins each part of one tile reports, on the site's ground. */
function tileJoins(
  site: Site,
  tile: string,
  bounds: TerrainBounds,
  heightAt: HeightAt
): Record<JoinPart, JoinPoint[]> {
  const walls = wallLines(site, tile);
  const gates = gatePoints(site, tile);
  const cut = cutWallGates(walls, gates);
  const surround = { groundAt: heightAt, walls: walls.map((w) => w.coords) };
  return {
    kerbs: kerbGeometry(kerbLines(site, tile), heightAt, OFFSET)?.joins ?? [],
    walls:
      wallGeometry(cut.walls, heightAt, OFFSET, { snapToStep: true })?.joins ??
      [],
    stairs: stairLines(site, tile).flatMap((stair) => {
      const [x, y] = axisMiddle(stair.coords);
      return ownsPoint(bounds, x, y)
        ? (stairGeometry(stair, OFFSET, surround)?.joins ?? [])
        : [];
    }),
    fences:
      fenceGeometry(fenceLines(site, tile), gates, heightAt, OFFSET, cut.leaves)
        ?.joins ?? [],
    sheds: smallBuildings(site, tile).flatMap(structureJoins),
    doors: doors(site, tile).flatMap(doorJoins),
    plinths: plinths(site, tile).flatMap(plinthJoins),
  };
}

/** Every part's joins over `tiles` (default: the whole site), checked. */
export async function measureJoins(
  tiles?: string[],
  site: Site = SITES[REFERENCE_SITE]
): Promise<Record<JoinPart, JoinReport>> {
  tiles ??= tileIds(site);
  // the measured tiles and the ones touching them: a wall or a fence near
  // a seam stands on its neighbour's ground
  const extent = new Map(
    site.tiles.map((cell) => [tileIdOf(site, cell), tileExtentOf(cell)])
  );
  const touches = (a: string, b: string) => {
    const [ax0, ay0, ax1, ay1] = extent.get(a) ?? [0, 0, 0, 0];
    const [bx0, by0, bx1, by1] = extent.get(b) ?? [0, 0, 0, 0];
    return ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1;
  };
  const all = [...extent.keys()].filter((t) =>
    tiles.some((m) => touches(t, m))
  );
  const grounds = await Promise.all(all.map((t) => tileGround(site, t)));
  const heightAt: HeightAt = (x, y) =>
    grounds.find((g) => ownsPoint(g.bounds, x, y))?.heightAt(x, y) ?? null;
  const joins = Object.fromEntries(
    JOIN_PARTS.map((part) => [part, [] as JoinPoint[]])
  ) as Record<JoinPart, JoinPoint[]>;
  for (const tile of tiles) {
    const bounds = grounds[all.indexOf(tile)].bounds;
    const found = tileJoins(site, tile, bounds, heightAt);
    for (const part of JOIN_PARTS) {
      joins[part].push(...found[part]);
    }
  }
  return Object.fromEntries(
    JOIN_PARTS.map((part) => [part, checkJoins(joins[part], heightAt)])
  ) as Record<JoinPart, JoinReport>;
}

/** The share of a report's joins that miss. */
export function missShare(r: JoinReport): number {
  return r.misses.length / Math.max(1, r.edges + r.feet);
}

if (import.meta.main) {
  // bun scripts/ground-joins.ts <site> [tile…]
  const { site, rest: tiles } = siteFromArgs(process.argv.slice(2));
  const reports = await measureJoins(
    tiles.length > 0 ? tiles : undefined,
    site
  );
  for (const part of JOIN_PARTS) {
    const r = reports[part];
    const edges = r.misses.filter((m) => m.join.kind === "edge").length;
    const share = (missShare(r) * 100).toFixed(2);
    process.stdout.write(
      `${part.padEnd(7)} ${r.feet} feet, ${r.edges} edges: ${r.misses.length} misses (${share} %; ${edges} edges)\n`
    );
    for (const m of r.misses.slice(0, 5)) {
      const { kind, x, y } = m.join;
      process.stdout.write(
        `          ${kind} at ${x.toFixed(1)} ${y.toFixed(1)} by ${m.by.toFixed(2)} m\n`
      );
    }
  }
}
