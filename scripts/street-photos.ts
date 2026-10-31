/**
 * `bun scripts/street-photos.ts <site> [--n N] [--seed S]`: the street
 * photos the model-fault check compares the twin with (docs/routines.md,
 * the `model-faults` skill). Picks N recent Panoramax photos spread over
 * the site — one per 400 m cell, the cells drawn by the seed (by default
 * the ISO week, so each week looks somewhere else) — and for each writes
 *
 * - `shots/foto-<site>-<n>.json`: a snapshot at the photo's pose (its
 *   place, the DGM1's ground + eye height, its heading turned to grid
 *   north, its lens, its time), which `bun run shots` renders;
 * - `street-photos/<site>/foto-<n>.jpg`: the photo (2048 px wide);
 * - `street-photos/<site>/pairs.json`: who took each photo, when, under
 *   which licence, and where it is on Panoramax.
 *
 * Both folders are gitignored: the photos are CC BY-SA and stay out of
 * the repository. Panoramax only (ADR: no Google Street View; Mapillary's
 * poses were off by ~0.6 m in 2026-10).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gridConvergenceDeg, latLngToUtm, utmToLatLng } from "../lib/city/crs";
import { siteExtentOf } from "../lib/city/site-extent";
import { siteFromArgs } from "../sites";
import { readDgmFile } from "./dgm-cache";
import { siteDgm } from "./line-levels";

const ROOT = join(import.meta.dir, "..");
const API = "https://api.panoramax.xyz/api";
/** Eye height of a phone held up (m). */
const EYE_M = 1.6;
/** A phone's horizontal lens where the photo does not say (degrees). */
const PHONE_HFOV = 65;
/** The shots' canvas aspect (e2e/snapshot-shot.spec.ts: 1600 × 1000). */
const SHOT_ASPECT = 1.6;
/** One photo per cell of this size (m), so they spread over the site. */
export const CELL_M = 400;
/** Photos placed worse than this are no use for comparing (m). */
const MAX_ACCURACY_M = 6;

export interface PanoramaxItem {
  id: string;
  collection?: string;
  geometry: { coordinates: [number, number] };
  properties: {
    datetime: string;
    license?: string;
    "view:azimuth"?: number;
    "geovisio:producer"?: string;
    "pers:interior_orientation"?: { field_of_view?: number };
    "quality:horizontal_accuracy"?: number;
  };
  assets: { sd?: { href: string } };
}

/** Whether a photo can stand beside a render: flat, aimed, well placed. */
export function usable(item: PanoramaxItem): boolean {
  const p = item.properties;
  const fov = p["pers:interior_orientation"]?.field_of_view;
  return (
    p["view:azimuth"] !== undefined &&
    item.assets.sd !== undefined &&
    (fov === undefined || fov < 180) &&
    (p["quality:horizontal_accuracy"] ?? 0) <= MAX_ACCURACY_M
  );
}

/** The vertical lens that shows the photo's width on the shot's canvas. */
export function verticalFov(hfov: number, aspect = SHOT_ASPECT): number {
  const half = (hfov * Math.PI) / 360;
  return (
    Math.round(
      ((2 * Math.atan(Math.tan(half) / aspect) * 180) / Math.PI) * 10
    ) / 10
  );
}

/** The ISO week of a day: "2026-W44". */
export function isoWeek(day: Date): string {
  const d = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  );
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - start) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** A small seeded shuffle (mulberry32 over the seed's hash). */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  let h = 1_779_033_703;
  for (const c of seed) {
    h = Math.imul(h ^ c.charCodeAt(0), 3_432_918_353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  const next = () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A cell of the site's grid, [minX, minY, maxX, maxY] in the CRS. */
export type Cell = [number, number, number, number];

/** The site's 400 m cells over its extent, in the seed's order. */
export function cellsInOrder(
  extent: [number, number, number, number],
  seed: string
): Cell[] {
  const cells: Cell[] = [];
  for (let x = extent[0]; x < extent[2]; x += CELL_M) {
    for (let y = extent[1]; y < extent[3]; y += CELL_M) {
      cells.push([
        x,
        y,
        Math.min(x + CELL_M, extent[2]),
        Math.min(y + CELL_M, extent[3]),
      ]);
    }
  }
  return shuffled(cells, seed);
}

/** The lat/lon box around a CRS box: all four corners (the grid is
 *  turned against the meridians, so two corners would cut strips off). */
export function lonLatBox(epsg: number, cell: Cell): number[] | null {
  const corners = [
    utmToLatLng(epsg, cell[0], cell[1]),
    utmToLatLng(epsg, cell[0], cell[3]),
    utmToLatLng(epsg, cell[2], cell[1]),
    utmToLatLng(epsg, cell[2], cell[3]),
  ];
  if (corners.some((c) => c === null)) {
    return null;
  }
  const lons = corners.map((c) => c!.lng);
  const lats = corners.map((c) => c!.lat);
  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];
}

/** The newest of a cell's usable photos inside it, or null. */
export function newestIn<T extends PanoramaxItem & { x: number; y: number }>(
  items: readonly T[],
  cell: Cell
): T | null {
  let best: T | null = null;
  for (const item of items) {
    const inside =
      item.x >= cell[0] &&
      item.x < cell[2] &&
      item.y >= cell[1] &&
      item.y < cell[3];
    if (
      inside &&
      usable(item) &&
      (!best || item.properties.datetime > best.properties.datetime)
    ) {
      best = item;
    }
  }
  return best;
}

/** One cell's photos since 2023 (a page: a cell rarely holds more). */
async function searchCell(bbox: number[]): Promise<PanoramaxItem[]> {
  const r = await fetch(
    `${API}/search?bbox=${bbox.join(",")}&limit=200&datetime=2023-01-01T00:00:00Z/..`,
    { signal: AbortSignal.timeout(60_000) }
  );
  if (!r.ok) {
    throw new Error(`Panoramax: HTTP ${r.status}`);
  }
  return ((await r.json()) as { features: PanoramaxItem[] }).features;
}

/** The cells' newest photos, in the seed's order, until `n` are found. */
async function pickPhotos(
  epsg: number,
  cells: readonly Cell[],
  n: number
): Promise<{
  picked: (PanoramaxItem & { x: number; y: number })[];
  looked: number;
}> {
  const picked: (PanoramaxItem & { x: number; y: number })[] = [];
  let looked = 0;
  for (const cell of cells) {
    if (picked.length >= n) {
      break;
    }
    const bbox = lonLatBox(epsg, cell);
    if (!bbox) {
      continue;
    }
    looked++;
    const items = (await searchCell(bbox)).flatMap((item) => {
      const [lon, lat] = item.geometry.coordinates;
      const p = latLngToUtm(epsg, lat, lon);
      return p ? [{ ...item, ...p }] : [];
    });
    const best = newestIn(items, cell);
    if (best) {
      picked.push(best);
    }
  }
  return { picked, looked };
}

async function main() {
  const { site, rest } = siteFromArgs(process.argv.slice(2));
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const n = Number(flag("--n") ?? 8);
  const seed = flag("--seed") ?? isoWeek(new Date());
  const epsg = site.provider.epsg;
  const { picked, looked } = await pickPhotos(
    epsg,
    cellsInOrder(siteExtentOf(site), seed),
    n
  );
  const heightAt = await siteDgm(site, (tif, tfw) =>
    readDgmFile(tif, tfw, "native")
  );
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "public/data", site.id, "manifest.json"), "utf8")
  ) as { files: Record<string, string> };
  const tileset = JSON.parse(
    readFileSync(
      join(ROOT, "public/data", site.id, manifest.files["tileset.json"]),
      "utf8"
    )
  ) as { extras: { offset: { cx: number; cy: number } } };
  const { cx, cy } = tileset.extras.offset;
  const photos = join(ROOT, "street-photos", site.id);
  mkdirSync(photos, { recursive: true });
  mkdirSync(join(ROOT, "shots"), { recursive: true });
  const pairs = [];
  for (const [i, item] of picked.entries()) {
    const ground = heightAt(item.x, item.y);
    if (ground === null) {
      continue;
    }
    const [lon, lat] = item.geometry.coordinates;
    const p = item.properties;
    const convergence = gridConvergenceDeg(epsg, lat, lon) ?? 0;
    const heading =
      ((((p["view:azimuth"] ?? 0) + convergence) % 360) + 360) % 360;
    const hfov = p["pers:interior_orientation"]?.field_of_view ?? PHONE_HFOV;
    const name = `foto-${site.id}-${String(i + 1).padStart(2, "0")}`;
    const snapshot = {
      v: 1,
      camera: {
        epsg: {
          x: Math.round(item.x * 10) / 10,
          y: Math.round(item.y * 10) / 10,
        },
        pos: { x: item.x - cx, y: ground + EYE_M, z: -(item.y - cy) },
        headingDeg: Math.round(heading * 10) / 10,
        pitchDeg: 0,
        fov: verticalFov(hfov),
        mode: "walk",
      },
      date: p.datetime,
      look: { style: "pastel" },
    };
    writeFileSync(
      join(ROOT, "shots", `${name}.json`),
      JSON.stringify(snapshot)
    );
    const image = await fetch(item.assets.sd!.href, {
      signal: AbortSignal.timeout(60_000),
    });
    if (image.ok) {
      writeFileSync(
        join(photos, `${name}.jpg`),
        new Uint8Array(await image.arrayBuffer())
      );
    }
    pairs.push({
      name,
      snapshot: `shots/${name}.json`,
      render: `shots/${name}.png`,
      photo: `street-photos/${site.id}/${name}.jpg`,
      panoramax: item.collection
        ? `${API}/collections/${item.collection}/items/${item.id}`
        : `${API}/search?ids=${item.id}`,
      taken: p.datetime,
      by: p["geovisio:producer"] ?? "unbekannt",
      licence: p.license ?? "CC-BY-SA-4.0",
      lensAssumed: p["pers:interior_orientation"]?.field_of_view === undefined,
    });
  }
  writeFileSync(
    join(photos, "pairs.json"),
    `${JSON.stringify({ seed, pairs }, null, 2)}\n`
  );
  process.stdout.write(
    `${pairs.length} Fotos aus ${looked} Zellen für ${site.name}, Woche ${seed}: street-photos/${site.id}/pairs.json\n`
  );
}

if (import.meta.main) {
  await main();
}
