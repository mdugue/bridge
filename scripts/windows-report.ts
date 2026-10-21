/**
 * What the windows draw on a site's tiles (`bun scripts/windows-report.ts
 * <site> [tile…]`): per tile the buildings with windows by where their
 * rhythm comes from (their own measured walls, another part of the
 * building, the nearest measured building, their type), and the share of
 * the window-carrying wall area that is a party wall (blank) or has no
 * ground-floor windows (over a shopfront, or with more doors than the
 * attribute holds); over all tiles the medians of the measured rhythms by
 * building type, the numbers `TYPES` keeps (lib/city/windows.ts). No
 * output files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasObjectFlag,
  OBJECT_FLAG_FLAT_ROOF,
  type OsmBuildingLut,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import type {
  DoorFeature,
  FeatureCollection,
  ShopfrontFile,
} from "../lib/city/features";
import type { LandmarkFile } from "../lib/city/landmarks";
import { cityMeshSourceFiles, tileIds } from "../lib/city/tile";
import type { CityJsonDocument } from "../lib/city/types";
import {
  FACADE_SCALE_M,
  type FacadeModel,
  type WindowFile,
  type WindowType,
  unpackStyle,
  windowType,
} from "../lib/city/windows";
import { siteFromArgs } from "../sites";
import { bakeCityMesh } from "./bake-city-mesh";

const ROOT = join(import.meta.dir, "..");
const read = <T>(path: string): T | undefined =>
  existsSync(join(ROOT, path))
    ? (JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T)
    : undefined;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : Number.NaN;
};

/** Wall area (m²) of a baked tile's window-carrying objects: with windows,
 *  blank (a party wall), without a ground-floor row (a negative length:
 *  over a shopfront, or more than two doors). */
function wallAreas(baked: ReturnType<typeof bakeCityMesh>) {
  const v = baked.vertices;
  const f = v.facade;
  const area = { windows: 0, party: 0, noGround: 0 };
  if (!f) {
    return area;
  }
  const p = v.positions;
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    if (!baked.objects[v.objectIds[t]]?.windows || v.isRoof[t] === 1) {
      continue;
    }
    const e1 = [0, 1, 2].map((c) => p[3 * (t + 1) + c] - p[3 * t + c]);
    const e2 = [0, 1, 2].map((c) => p[3 * (t + 2) + c] - p[3 * t + c]);
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const a =
      Math.hypot(
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        nz
      ) / 2;
    if (Math.abs(nz) > 0.1 * 2 * a) {
      continue;
    }
    const length = (f[4 * t + 1] / 32_767) * FACADE_SCALE_M;
    if (length === 0) {
      area.party += a;
    } else if (length < 0) {
      area.noGround += a;
    } else {
      area.windows += a;
    }
  }
  return area;
}

const { site, rest } = siteFromArgs(process.argv.slice(2));
const tiles = rest.length > 0 ? rest : tileIds(site);
const byType = new Map<WindowType, FacadeModel[]>();
for (const tile of tiles) {
  const src = cityMeshSourceFiles(site, tile);
  const doc = read<CityJsonDocument>(src.city);
  if (!doc) {
    continue;
  }
  const file = read<WindowFile>(src.windows);
  const walls = Object.values(file?.buildings ?? {}).flat();
  // the OSM facts and the landmarks: the windows' gate reads them
  const osm: OsmBuildingLut = {
    ...read<{ objects?: OsmBuildingLut }>(src.osmBuild)?.objects,
  };
  for (const lm of read<LandmarkFile>(src.landmarks)?.landmarks ?? []) {
    for (const id of lm.objects) {
      osm[id] = { ...osm[id], landmark: 1 };
    }
  }
  const t0 = performance.now();
  const baked = bakeCityMesh(
    tile,
    doc,
    undefined,
    null,
    osm,
    undefined,
    "render",
    undefined,
    undefined,
    {
      doors: read<FeatureCollection<DoorFeature>>(src.doors)?.features,
      shopfronts: Object.values(
        read<ShopfrontFile>(src.shopfronts)?.buildings ?? {}
      ).flat(),
      windows: walls,
    }
  );
  const seconds = (performance.now() - t0) / 1000;
  const counts = { measured: 0, near: 0, type: 0, none: 0 };
  for (const o of baked.objects) {
    if (!o.building && o.footprints.length === 0) {
      continue;
    }
    const style = o.windows ? unpackStyle(o.windows.style) : undefined;
    if (!style) {
      counts.none++;
    } else if (style.measured) {
      counts.measured++;
    } else if (style.near) {
      counts.near++;
    } else {
      counts.type++;
    }
  }
  const area = wallAreas(baked);
  const total = area.windows + area.party + area.noGround || 1;
  const pct = (x: number) => `${Math.round((100 * x) / total)} %`;
  process.stdout.write(
    `${tile}: windows on ${counts.measured} measured, ${counts.near} by a neighbour, ` +
      `${counts.type} by type, none on ${counts.none}; wall area ${Math.round(total)} m²: ` +
      `${pct(area.windows)} windows, ${pct(area.party)} party walls, ${pct(area.noGround)} without ground-floor windows (shopfronts, 3+ doors) ` +
      `(bake ${seconds.toFixed(1)} s)\n`
  );
  const index = new Map(
    Object.keys(withoutTrafficStructures(doc).CityObjects).map(
      (id, i) => [id, i] as const
    )
  );
  for (const w of walls) {
    const o = w.model ? baked.objects[index.get(w.oid) ?? -1] : undefined;
    if (!(o && w.model)) {
      continue;
    }
    const type = windowType(
      hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF),
      o.eaveH,
      o.storeyH
    );
    byType.set(type, [...(byType.get(type) ?? []), w.model]);
  }
}
for (const [type, models] of [...byType].sort(([a], [b]) =>
  a.localeCompare(b)
)) {
  process.stdout.write(
    `${type}: ${models.length} measured walls — axis ${median(models.map((m) => m.axis)).toFixed(2)}, ` +
      `w ${median(models.map((m) => m.w)).toFixed(2)}, h ${median(models.map((m) => m.h)).toFixed(2)}, ` +
      `loose ${Math.round((100 * models.filter((m) => m.grid === "loose").length) / models.length)} %, ` +
      `ornament ${Math.round((100 * models.filter((m) => m.orn).length) / models.length)} %\n`
  );
}
