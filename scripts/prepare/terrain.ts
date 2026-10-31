/**
 * Step 2 of scripts/prepare-data.ts, the terrain: a tile's two levels as
 * glTF (the fine one with its stairs, walls, kerbs and fences) and the
 * coarse level's crowns (bake-entries.ts `terrain`, `coarseCrowns`).
 */
import { existsSync, readFileSync } from "node:fs";
import { cutWallGates } from "../../lib/city/fences";
import { tileExtentOf } from "../../lib/city/site";
import type { TerrainBounds } from "../../lib/city/terrain-geometry";
import {
  cityMeshSourceFiles,
  COARSE_DRESSING_KINDS,
  DRESSING_KINDS,
  pickFiles,
  type TileArtifactKind,
  dgmSourceFiles,
  sideFileSource,
  tileArtifacts,
} from "../../lib/city/tile";
import { TERRAIN_LEVELS, type TerrainExtras } from "../../lib/city/tileset";
import { bakeCoarseCrowns } from "../coarse-crowns";
import { BAKE_ENTRIES } from "../bake-entries";
import {
  fenceMesh,
  kerbMesh,
  stairMesh,
  type TerrainMesh,
  terrainMesh,
  wallMesh,
  gridMesh,
  stairRailLines,
  tinMesh,
} from "../bake-tiles";
import { FINE_TIN_MAX_ERROR } from "../bake-terrain-tin";
import type { ColonyCrop } from "../crop-raster";
import { unpackGround } from "../ground-pack";
import { writeMeshGlb } from "../tile-glb";
import {
  fenceLines,
  gatePoints,
  kerbLines,
  stairLines,
  wallLines,
} from "../tile-sources";
import { siteWaterTints, waterLook } from "../../lib/city/water-bodies";
import {
  HINT,
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  fail,
  gz,
  parse,
  publish,
  utf8,
} from "./context";
import { shapedBy, siteShapes } from "./lines";
import { type Published, colonyCrops, sideFiles } from "./side-files";
import { offset } from "./frame";
import {
  groundFeatures,
  groundFile,
  siteGround,
  terrainInputs,
  tileDgm,
  waterOf,
} from "./ground";

/** A level's `water` extras (lib/city/water-bodies.ts `waterLook`), none
 *  where it has nothing to say; every tile's bodies' colours pooled across
 *  the seams (`siteWaterTints`) once for the site. */
let waterTints: Map<string, number[]> | undefined;
function waterExtras(
  tile: string,
  level: 0 | 1
): Pick<TerrainExtras, "water"> | Record<string, never> {
  waterTints ??= siteWaterTints(
    TILES.map((id, i) => ({
      id,
      bounds: tileExtentOf(SITE.tiles[i]),
      member: waterOf(id),
    }))
  );
  // foam is a close look: the fine level's
  const water = waterLook(
    waterOf(tile),
    waterTints.get(tile) ?? [],
    offset,
    level === 0
  );
  return water ? { water } : {};
}

/** A tile's shaped terrain at one level (memoised until the tile is baked:
 *  `dropTerrain`). The fine level is the cached ground meshed (`groundFile`),
 *  the coarse one the resampled grid. */
const terrains = new Map<
  string,
  Promise<TerrainMesh & { bounds: TerrainBounds }>
>();
function shapedTerrain(
  tile: string,
  level: 0 | 1
): Promise<TerrainMesh & { bounds: TerrainBounds }> {
  const memo = `${tile}:${level}`;
  let built = terrains.get(memo);
  if (!built) {
    built = (async () => {
      if (level === 0) {
        const ground = unpackGround(readFileSync(await groundFile(tile)));
        return ground.kind === "tin"
          ? {
              ...tinMesh(ground.tin, offset, FINE_TIN_MAX_ERROR),
              bounds: ground.tin.bounds,
            }
          : { ...gridMesh(ground.grid, offset), bounds: ground.grid.bounds };
      }
      const dgm = await tileDgm(tile, TERRAIN_LEVELS[level].n);
      const mesh = terrainMesh(
        dgm,
        wallLines(SITE, tile),
        offset,
        await groundFeatures(tile)
      );
      return { ...mesh, bounds: dgm.bounds };
    })();
    terrains.set(memo, built);
  }
  return built;
}

/** Frees a baked tile's shaped terrain (its meshes' arrays). */
export function dropTerrain(tile: string): void {
  terrains.delete(`${tile}:0`);
  terrains.delete(`${tile}:1`);
}

/** The fine level's own nodes beside the grid: the stairs it owns, its
 *  walls, its kerb stones and its fences (the flights' handrails among
 *  them), standing on every tile's shaped ground. Gates cut the fences and
 *  the freestanding walls. */
async function fineChildren(
  tile: string,
  bounds: TerrainExtras["bounds"]
): Promise<NonNullable<Parameters<typeof writeMeshGlb>[0]["children"]>> {
  const ground = await siteGround();
  const flights = stairLines(SITE, tile);
  const stairs = stairMesh(flights, offset, bounds, {
    groundAt: ground.heightAt,
    walls: wallLines(SITE, tile).map((w) => w.coords),
  });
  const gates = gatePoints(SITE, tile);
  const cut = cutWallGates(wallLines(SITE, tile), gates);
  const walls = wallMesh(cut.walls, ground.heightAt, offset, {
    snapToStep: ground.tin,
  });
  const kerbs = kerbMesh(kerbLines(SITE, tile), ground.heightAt, offset);
  // a flight's handrails stand with the fences, on its nosing line
  const fences = fenceMesh(
    [...fenceLines(SITE, tile), ...stairRailLines(flights, bounds)],
    gates,
    ground.heightAt,
    offset,
    cut.leaves
  );
  return [stairs, walls, kerbs, fences].filter((m) => m !== null);
}

/** The fine level's allotment colonies (plan 028) and road markings (plan
 *  026) and both levels' baked light (plan 033): only the rasters the tile
 *  has. */
function paintAndLight(
  names: Published,
  level: 0 | 1,
  crop: ColonyCrop | undefined
): Partial<TerrainExtras> {
  return {
    ...(level === 0 && names.cultivatedRaster && crop
      ? {
          cultivated: names.cultivatedRaster,
          cultivatedCrop: crop,
          ...(names.cultivatedLow
            ? { cultivatedLow: names.cultivatedLow }
            : {}),
        }
      : {}),
    ...(level === 0 && names.markings && names.markingsTable
      ? {
          markings: names.markings,
          markingsTable: names.markingsTable,
          ...(names.markingsLow ? { markingsLow: names.markingsLow } : {}),
        }
      : {}),
    ...(names.svf ? { svf: names.svf } : {}),
    ...(names.horizon ? { horizon: names.horizon } : {}),
  };
}

/**
 * The trees the tile's coarse level draws (lib/city/coarse-crowns.ts,
 * scripts/coarse-crowns.ts): the fine level's own placement of the tile's
 * trees on its own ground, a third of them. Pre-gzipped like the packed
 * canopy.
 */
async function publishCrowns(tile: string): Promise<string | undefined> {
  const a = tileArtifacts(tile);
  const side = (kind: TileArtifactKind) => {
    const path = at(sideFileSource(SITE, a[kind].file));
    return existsSync(path) ? path : undefined;
  };
  const sources = {
    canopy: side("canopy"),
    canopyx: side("canopyx"),
    cultivated: side("cultivated"),
    monuments: side("monuments"),
    ndvi: side("ndvi"),
    city: existsSync(at(cityMeshSourceFiles(SITE, tile).city))
      ? at(cityMeshSourceFiles(SITE, tile).city)
      : undefined,
    sheds: existsSync(at(cityMeshSourceFiles(SITE, tile).smallBuild))
      ? at(cityMeshSourceFiles(SITE, tile).smallBuild)
      : undefined,
    structures: existsSync(at(cityMeshSourceFiles(SITE, tile).structures))
      ? at(cityMeshSourceFiles(SITE, tile).structures)
      : undefined,
    trees: side("trees"),
    vegrows: side("vegrows"),
  };
  if (
    !(sources.canopy || sources.canopyx || sources.trees || sources.vegrows)
  ) {
    return undefined;
  }
  const inputs = [
    ...Object.values(sources).filter((p): p is string => p !== undefined),
    ...terrainInputs(tile),
  ];
  const [minX, minY] = tileExtentOf(SITE.tiles[TILES.indexOf(tile)]);
  const file = a.crowns.file;
  const bytes = await cached(
    file,
    cacheKey(inputs, BAKE_ENTRIES.coarseCrowns, offset, shapedBy(tile)),
    async () => {
      const fine = await shapedTerrain(tile, 0);
      return gz(
        await bakeCoarseCrowns(sources, {
          bounds: fine.bounds,
          heightAt: fine.heightAt,
          offset,
          origin: [minX, minY],
        })
      );
    }
  );
  return publish(file, bytes);
}

/** A tile's terrain at one level: glTF + its extent and elevation range. */
export async function bakeTerrain(
  tile: string,
  level: 0 | 1
): Promise<{
  file: string;
  ground?: number[];
  maxZ: number;
  minZ: number;
}> {
  const source = dgmSourceFiles(SITE, tile);
  if (!existsSync(at(source.tif))) {
    fail(`missing source file ${source.tif}${HINT}`);
  }
  const names = sideFiles.get(tile) ?? {};
  if (level === 1) {
    const crowns = await publishCrowns(tile);
    if (crowns) {
      names.crowns = crowns;
    }
  }
  const { n } = TERRAIN_LEVELS[level];
  // The fine level's walls stand on the neighbours' ground too.
  const inputs =
    level === 0 ? TILES.flatMap(terrainInputs) : terrainInputs(tile);
  const stem = `terrain_${tile}_l${level}`;
  const described = {
    kind: "terrain" as const,
    tileId: tile,
    level,
    n,
    // the coarse level reads its 1024² raster on every tier
    // (lib/city/tile.ts COARSE_RASTER_PX)
    landcover: (level === 0 ? names.landcover : names.landcoverCoarse) ?? "",
    landcoverLow:
      (level === 0 ? names.landcoverLow : names.landcoverCoarse) ?? "",
    ...(names.ndvi ? { ndvi: names.ndvi } : {}),
    ...(level === 0 && names.surface ? { surface: names.surface } : {}),
    ...(level === 0 && names.edges ? { edges: names.edges } : {}),
    ...(names.sport && names.sportTable
      ? { sport: names.sport, sportTable: names.sportTable }
      : {}),
    ...paintAndLight(names, level, colonyCrops.get(tile)),
    ...waterExtras(tile, level),
    ...(level === 0
      ? { dressing: pickFiles(names, DRESSING_KINDS) }
      : { coarse: pickFiles(names, COARSE_DRESSING_KINDS) }),
  };
  // The passages come from every tile's lines and decks (line-levels.ts);
  // the fine level's walls, kerbs, stairs and fences stand on every tile's
  // fine ground, and so on every tile's passages.
  const opened = level === 0 ? siteShapes : shapedBy(tile);
  const bake = BAKE_ENTRIES.terrain;
  const key = cacheKey(inputs, bake, offset, described, opened);
  const meta = parse<{
    bounds: TerrainExtras["bounds"];
    ground?: number[];
    maxZ: number;
    minZ: number;
    tin?: TerrainExtras["tin"];
  }>(
    await cached(
      `${stem}.json`,
      cacheKey(inputs, bake, offset, described, opened, "ground"),
      async () => {
        const m = await shapedTerrain(tile, level);
        return utf8({
          bounds: m.bounds,
          minZ: m.minElevation,
          maxZ: m.maxElevation,
          ...(level === 1 ? { ground: groundSamples(m) } : {}),
          ...(m.tin ? { tin: m.tin } : {}),
        });
      }
    )
  );
  const extras: TerrainExtras = {
    ...described,
    bounds: meta.bounds,
    minElevation: meta.minZ,
    ...(meta.tin ? { tin: meta.tin } : {}),
  };
  const name = `${stem}.glb.gz`;
  const glb = await cached(name, key, async () =>
    gz(
      await writeMeshGlb({
        ...(await shapedTerrain(tile, level)).input,
        name: "terrain",
        extras: { ...extras },
        // The fine level carries the tile's stairs and walls, baked from the
        // same files the ground was shaped with.
        children: level === 0 ? await fineChildren(tile, meta.bounds) : [],
      })
    )
  );
  return {
    file: publish(name, glb),
    ground: meta.ground,
    minZ: meta.minZ,
    maxZ: meta.maxZ,
  };
}

/** The ground's heights on a coarse grid over the tile (the valley haze's
 *  relief: lib/city/valley-fog.ts). */
function groundSamples(m: {
  bounds: TerrainBounds;
  heightAt: (x: number, y: number) => number | null;
}): number[] {
  const [x0, y0, x1, y1] = m.bounds;
  const out: number[] = [];
  const n = 32;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const h = m.heightAt(
        x0 + ((i + 0.5) / n) * (x1 - x0),
        y0 + ((j + 0.5) / n) * (y1 - y0)
      );
      if (h !== null) {
        out.push(Math.round(h * 10) / 10);
      }
    }
  }
  return out;
}
