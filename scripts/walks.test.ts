import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WikidataFile } from "../lib/city/stadtwissen";
import { WIKIDATA_FACTS_FILE } from "../lib/city/stadtwissen";
import { tileExtentOf, tileIdOf } from "../lib/city/site";
import {
  cityJsonFile,
  sideFileSource,
  siteDataDir,
  tileArtifacts,
} from "../lib/city/tile";
import { type Walk, WALKS_DIR, walkProblems } from "../lib/city/walks";
import { SITES } from "../sites";
import { monumentsOf, type MonumentCollection } from "./bake-stadtwissen";
import { readDgmFile } from "./dgm-cache";
import { siteDgm } from "./line-levels";

/**
 * Every committed walk (lib/city/walks.ts, ADR 0053) is checked against
 * the data it stands on: well formed, its stops inside the site and on its
 * measured ground — the pitch of every view is reckoned from it — and every
 * Stadtwissen entry it names is one the build publishes.
 */
const ROOT = join(import.meta.dir, "..");
/** How far a stop's written ground may lie off the DGM (it is rounded to 0.1 m). */
const GROUND_TOLERANCE_M = 0.2;

const sitesWithWalks = Object.values(SITES).flatMap((site) => {
  const dir = join(ROOT, siteDataDir(site), WALKS_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  const walks = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Walk);
  return [{ site, walks }];
});

test("the reference site has walks", () => {
  expect(sitesWithWalks.some(({ site }) => site.id === "dresden")).toBe(true);
});

for (const { site, walks } of sitesWithWalks) {
  const tileOf = (x: number, y: number) =>
    site.tiles.find((cell) => {
      const [x0, y0, x1, y1] = tileExtentOf(cell);
      return x >= x0 && x < x1 && y >= y0 && y < y1;
    });

  describe(`${site.id}'s walks`, () => {
    test("are well formed", () => {
      expect(walks.flatMap(walkProblems)).toEqual([]);
    });

    test("stand and look inside the site", () => {
      const outside = walks.flatMap((w) =>
        w.stops
          .filter(
            (s) => !(tileOf(s.from[0], s.from[1]) && tileOf(s.at[0], s.at[1]))
          )
          .map((s) => `${w.id}/${s.id}`)
      );
      expect(outside).toEqual([]);
    });

    test("stand on the measured ground", async () => {
      const heightAt = await siteDgm(site, (tif, tfw) =>
        readDgmFile(tif, tfw, "native")
      );
      const off = walks.flatMap((w) =>
        w.stops.flatMap((s) => {
          const h = heightAt(s.from[0], s.from[1]);
          return h !== null && Math.abs(h - s.ground) <= GROUND_TOLERANCE_M
            ? []
            : [`${w.id}/${s.id}: ${s.ground} m, the DGM ${h ?? "none"}`];
        })
      );
      expect(off).toEqual([]);
    }, 60_000);

    test("name only Stadtwissen entries the build publishes", () => {
      const named = new Set(
        walks.flatMap((w) =>
          w.stops.flatMap((s) => [
            ...(s.refs ?? []),
            ...s.facts
              .filter((f) => f.source.startsWith("stadtwissen:"))
              .map((f) => f.source.slice("stadtwissen:".length)),
          ])
        )
      );
      const wikidataPath = join(ROOT, siteDataDir(site), WIKIDATA_FACTS_FILE);
      const wikidata = existsSync(wikidataPath)
        ? (JSON.parse(readFileSync(wikidataPath, "utf8")) as WikidataFile)
        : { entities: {} };
      const monuments = new Set(
        site.tiles.flatMap((cell) => {
          const file = join(
            ROOT,
            sideFileSource(
              site,
              tileArtifacts(tileIdOf(site, cell)).monuments.file
            )
          );
          return existsSync(file)
            ? monumentsOf(
                JSON.parse(readFileSync(file, "utf8")) as MonumentCollection
              ).map((m) => m.id)
            : [];
        })
      );
      const cityText = new Map<string, string>();
      const inCity = (id: string) =>
        site.tiles.some((cell) => {
          const tile = tileIdOf(site, cell);
          const path = join(
            ROOT,
            siteDataDir(site),
            "cityjson",
            cityJsonFile(tile)
          );
          if (!cityText.has(tile)) {
            cityText.set(
              tile,
              existsSync(path) ? readFileSync(path, "utf8") : ""
            );
          }
          return cityText.get(tile)?.includes(`"${id}"`) ?? false;
        });
      const missing = [...named].filter((id) =>
        /^Q\d+$/.test(id)
          ? !(id in wikidata.entities)
          : /^m\d+_\d+$/.test(id)
            ? !monuments.has(id)
            : !inCity(id)
      );
      expect(missing).toEqual([]);
    }, 60_000);
  });
}
