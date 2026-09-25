/**
 * `bun run site [--all]`: where the site `SITE` names stands — per tile,
 * what is on disk and the command that moves it forward — and how much its
 * data folder weighs (the number the commit decision needs, ADR 0030).
 * `--all` prints one line per registered site.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { WATER_CLASS } from "../lib/city/landcover";
import { buildingFootprintPolys } from "../lib/city/minimap";
import { type Site, tileExtentOf, tileIdOf } from "../lib/city/site";
import {
  siteReport,
  siteSummary,
  walkViewpointIssue,
} from "../lib/city/site-report";
import {
  cityMeshSourceFiles,
  sideFileSource,
  siteDataDir,
  tileArtifacts,
} from "../lib/city/tile";
import type { CityJsonDocument } from "../lib/city/types";
import { currentSite, SITES } from "../sites";

function bytesUnder(dir: string): number {
  if (!existsSync(dir)) {
    return 0;
  }
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => statSync(join(dir, f)))
    .filter((s) => s.isFile())
    .reduce((sum, s) => sum + s.size, 0);
}

/** Checks each walk viewpoint against the tile it stands on, when that
 *  tile's CityJSON and class raster are on disk. */
async function checkViewpoints(site: Site): Promise<string[]> {
  const lines: string[] = [];
  for (const v of site.viewpoints.filter((vp) => vp.mode === "walk")) {
    const cell = site.tiles.find((c) => {
      const [x0, y0, x1, y1] = tileExtentOf(c);
      return v.epsg.x >= x0 && v.epsg.x < x1 && v.epsg.y >= y0 && v.epsg.y < y1;
    });
    if (!cell) {
      lines.push(`  ${v.id}: not on any tile of the site`);
      continue;
    }
    const tile = tileIdOf(site, cell);
    const city = cityMeshSourceFiles(site, tile).city;
    const raster = sideFileSource(site, tileArtifacts(tile).landcover.file);
    if (!(existsSync(city) && existsSync(raster))) {
      continue;
    }
    const doc = JSON.parse(readFileSync(city, "utf8")) as CityJsonDocument;
    const footprints = buildingFootprintPolys(doc).map((p) => p.pts);
    const { data, info } = await sharp(raster)
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const [x0, y0, x1, y1] = tileExtentOf(cell);
    const classAt = (x: number, y: number) => {
      const col = Math.floor(((x - x0) / (x1 - x0)) * info.width);
      const row = Math.floor(((y1 - y) / (y1 - y0)) * info.height);
      return data[row * info.width + col] ?? null;
    };
    const issue = walkViewpointIssue(v.epsg, footprints, classAt, WATER_CLASS);
    lines.push(`  ${v.id}: ${issue ?? "ok"}`);
  }
  return lines;
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const out = (line = "") => process.stdout.write(`${line}\n`);

if (process.argv.includes("--all")) {
  for (const site of Object.values(SITES)) {
    const tiles = siteReport(site, existsSync);
    const ready = tiles.filter((t) => t.next === "ready").length;
    out(
      `${site.id.padEnd(10)} ${site.provider.id}  ${ready}/${tiles.length} tiles ready  ${mb(bytesUnder(siteDataDir(site)))}`
    );
  }
} else {
  const site = currentSite();
  for (const line of siteSummary(site)) {
    out(line);
  }
  out(`data: ${siteDataDir(site)}/ (${mb(bytesUnder(siteDataDir(site)))})`);
  out();
  const checks = await checkViewpoints(site);
  if (checks.length > 0) {
    out("walk viewpoints (on the data):");
    for (const line of checks) {
      out(line);
    }
    out();
  }
  for (const t of siteReport(site, existsSync)) {
    out(`${t.tile}  ${t.next === "ready" ? "ready" : `→ bun run ${t.next}`}`);
    for (const p of t.missing) {
      out(`  missing  ${p}`);
    }
    for (const p of t.absent) {
      out(`  off      ${p}`);
    }
  }
}
