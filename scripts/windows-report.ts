/**
 * What the facade traits draw on a site's tiles (`bun scripts/windows-
 * report.ts <site> [tile…]`): per tile the walls with a model, the walls
 * and windows the building bake draws, the buildings they are on, the
 * triangles they add and the features' reliability on that tile
 * (pipeline/bake/windows.py, lib/city/windows.ts). No output files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DoorFeature,
  FeatureCollection,
  PlinthFeature,
  ShopfrontFile,
} from "../lib/city/features";
import {
  type OsmBuildingLut,
  OBJECT_SOURCE_WINDOW,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import { cityMeshSourceFiles, tileIds } from "../lib/city/tile";
import type { CityJsonDocument } from "../lib/city/types";
import type { LandmarkFile } from "../lib/city/landmarks";
import type { WindowFile, WindowWall } from "../lib/city/windows";
import { siteFromArgs } from "../sites";
import { appendWindows, bakeCityMesh } from "./bake-city-mesh";

const ROOT = join(import.meta.dir, "..");
const read = <T>(path: string): T | undefined =>
  existsSync(join(ROOT, path))
    ? (JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T)
    : undefined;

const { site, rest } = siteFromArgs(process.argv.slice(2));
const tiles = rest.length > 0 ? rest : tileIds(site);
for (const tile of tiles) {
  const src = cityMeshSourceFiles(site, tile);
  const file = read<WindowFile>(src.windows);
  const walls = Object.values(file?.buildings ?? {}).flat();
  const modelled = walls.filter((w) => w.model);
  const doc = read<CityJsonDocument>(src.city);
  if (!doc) {
    continue;
  }
  const onWalls = {
    doors: read<FeatureCollection<DoorFeature>>(src.doors)?.features,
    plinths: read<FeatureCollection<PlinthFeature>>(src.plinths)?.features,
    shopfronts: Object.values(
      read<ShopfrontFile>(src.shopfronts)?.buildings ?? {}
    ).flat(),
  };
  // the OSM facts and the landmarks: the windows' gate reads them
  const osm: OsmBuildingLut = {
    ...read<{ objects?: OsmBuildingLut }>(src.osmBuild)?.objects,
  };
  for (const lm of read<LandmarkFile>(src.landmarks)?.landmarks ?? []) {
    for (const id of lm.objects) {
      osm[id] = { ...osm[id], landmark: 1 };
    }
  }
  const bake = (windows?: WindowWall[]) =>
    bakeCityMesh(
      tile,
      doc,
      undefined,
      null,
      osm,
      undefined,
      "render",
      undefined,
      undefined,
      { ...onWalls, windows }
    );
  const t0 = performance.now();
  const plain = bake();
  const t1 = performance.now();
  const baked = bake(walls);
  const t2 = performance.now();
  const tris = (b: typeof baked) => b.vertices.positions.length / 9;
  const plainTris = tris(plain);
  const keys = Object.keys(withoutTrafficStructures(doc).CityObjects);
  const drawn = appendWindows(
    plain,
    walls,
    onWalls.shopfronts,
    new Map(keys.map((id, i) => [id, i]))
  );
  const rows = baked.objects.filter((o) => o.source === OBJECT_SOURCE_WINDOW);
  const hosts = new Set(rows.map((o) => o.root));
  process.stdout.write(
    `${tile}: ${walls.length} walls measured, ${modelled.length} modelled; ` +
      `${drawn.windows} windows on ${drawn.walls} walls of ${hosts.size} buildings; +${tris(baked) - plainTris} triangles ` +
      `(${plainTris} → ${tris(baked)}); bake ${((t1 - t0) / 1000).toFixed(1)} s → ${((t2 - t1) / 1000).toFixed(1)} s\n`
  );
}
