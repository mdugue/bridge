/**
 * `bun scripts/walks.ts <site> <command>`: the author's tools for the
 * Erzählte Spaziergänge (lib/city/walks.ts) of `data/<site>/walks/`.
 *
 *   ground          writes each stop's `ground` from the site's DGM1
 *   shots [walk]    writes each stop as a snapshot to shots/ (bun run shots
 *                   renders them; needs the site built, for its offset)
 *   check           prints what walks.test.ts would refuse
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { siteDataDir } from "../lib/city/tile";
import {
  stopCamera,
  stopDate,
  type Walk,
  WALKS_DIR,
  walkProblems,
} from "../lib/city/walks";
import { siteFromArgs } from "../sites";
import { readDgmFile } from "./dgm-cache";
import { siteDgm } from "./line-levels";

const ROOT = join(import.meta.dir, "..");
const { site, rest } = siteFromArgs(process.argv.slice(2));
const dir = join(ROOT, siteDataDir(site), WALKS_DIR);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const walks = files.map((f) => ({
  file: join(dir, f),
  walk: JSON.parse(readFileSync(join(dir, f), "utf8")) as Walk,
}));
const out = (line: string) => process.stdout.write(`${line}\n`);

async function fillGround(): Promise<void> {
  const heightAt = await siteDgm(site, (tif, tfw) =>
    readDgmFile(tif, tfw, "native")
  );
  for (const { file, walk } of walks) {
    for (const stop of walk.stops) {
      const h = heightAt(stop.from[0], stop.from[1]);
      if (h === null) {
        out(`${walk.id}/${stop.id}: no ground at ${stop.from.join(", ")}`);
        continue;
      }
      stop.ground = Math.round(h * 10) / 10;
    }
    writeFileSync(file, `${JSON.stringify(walk, null, 2)}\n`);
    out(`${walk.id}: ${walk.stops.length} stops grounded`);
  }
}

function writeShots(only?: string): void {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "public/data", site.id, "manifest.json"), "utf8")
  ) as { files: Record<string, string> };
  const tileset = JSON.parse(
    readFileSync(
      join(ROOT, "public/data", site.id, manifest.files["tileset.json"]),
      "utf8"
    )
  ) as { extras: { offset: { cx: number; cy: number } } };
  const offset = tileset.extras.offset;
  mkdirSync(join(ROOT, "shots"), { recursive: true });
  const today = new Date();
  for (const { walk } of walks.filter((w) => !only || w.walk.id === only)) {
    walk.stops.forEach((stop, i) => {
      const camera = stopCamera(stop, offset);
      const date = stopDate(stop, today);
      const snapshot = {
        v: 1,
        camera,
        date: date.toISOString(),
        look: { style: stop.style ?? "pastel" },
      };
      const name = `walk-${walk.id}-${String(i + 1).padStart(2, "0")}-${stop.id}.json`;
      writeFileSync(join(ROOT, "shots", name), JSON.stringify(snapshot));
      out(name);
    });
  }
}

switch (rest[0]) {
  case "ground":
    await fillGround();
    break;
  case "shots":
    writeShots(rest[1]);
    break;
  case "check":
    for (const { walk } of walks) {
      walkProblems(walk).forEach(out);
    }
    break;
  default:
    out("ground | shots [walk] | check");
}
