import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DRESDEN } from "../../sites/dresden";
import { SITES } from "../../sites/index";
import type { Site } from "./site";
import {
  cityMeshSourceFiles,
  dgmSourceFiles,
  kerbSourceFile,
  siteDataDir,
  sideFileSource,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  tileIds,
  wallSourceFile,
} from "./tile";

// Every tile of a site carries the same baked data. An optional artifact
// that is missing is not an error anywhere else — prepare-data leaves it
// out and the layer stays off — so a bake step run on some tiles only (a new
// step from main, a tile added later) would ship as a quietly poorer part of
// the city. This is where it fails instead: add the tile to the site, run
// `bun run fetch <tile>` and `bun run bake <tile>`, and this test says what
// is still missing. It covers every site whose data is on disk (Dresden's is
// committed; another site's is there once it is fetched).

const ROOT = join(import.meta.dir, "..", "..");

/**
 * Artifact kinds a tile may lack for a reason in the data, not in the bake.
 * Keep this short and say why; "not baked yet" is never a reason.
 */
const MAY_LACK: Record<string, string> = {};

/** `<kind><suffix>` → the tiles that carry it, over the per-tile folders. */
function kindsOnDisk(site: Site): Map<string, Set<string>> {
  const suffix = site.provider.tileSuffix;
  const tileInName = new RegExp(`_(\\d{5}_\\d{4}_2${suffix})(.*)$`);
  const kinds = new Map<string, Set<string>>();
  for (const sub of ["dlm", "dop"]) {
    const dir = `${siteDataDir(site)}/${sub}`;
    if (!existsSync(join(ROOT, dir))) {
      continue;
    }
    for (const name of readdirSync(join(ROOT, dir))) {
      const m = tileInName.exec(name);
      if (!m) {
        continue;
      }
      const kind = `${dir}/${name.slice(0, m.index)}_*${m[2]}`;
      const tiles = kinds.get(kind) ?? new Set<string>();
      tiles.add(m[1]);
      kinds.set(kind, tiles);
    }
  }
  return kinds;
}

const ON_DISK = Object.values(SITES).filter((site) =>
  existsSync(join(ROOT, siteDataDir(site), "dlm"))
);

test("the committed site's data is on disk", () => {
  expect(ON_DISK).toContain(DRESDEN);
});

describe.each(ON_DISK.map((site) => [site.id, site] as const))(
  "%s",
  (_, site) => {
    const tiles = tileIds(site);

    test("no baked file belongs to a tile outside the site", () => {
      const strays = [...kindsOnDisk(site)].flatMap(([kind, has]) =>
        [...has].filter((t) => !tiles.includes(t)).map((t) => `${kind} ${t}`)
      );
      expect(strays).toEqual([]);
    });

    test("every kind of baked file that one tile has, every tile has", () => {
      const missing: string[] = [];
      for (const [kind, has] of kindsOnDisk(site)) {
        const base = kind.split("/").pop()?.split("_*")[0] ?? kind;
        if (base in MAY_LACK) {
          continue;
        }
        for (const tile of tiles) {
          if (!has.has(tile)) {
            missing.push(kind.replace("*", tile));
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }
);

// Which optional artifacts a site can have depends on its provider's open
// products (no DOP infrared, no NDVI; no Basis-DLM, no rail), so the full
// list is held against the committed site, which has them all.
test("every Dresden tile has every artifact the viewer reads and every bake input", () => {
  const missing: string[] = [];
  for (const tile of tileIds(DRESDEN)) {
    const files = [
      ...Object.entries(tileArtifacts(tile))
        // A downsampled raster is made at build time, not committed.
        .filter(([kind, a]) => !a.bakedFrom && !(kind in MAY_LACK))
        .map(([, a]) => sideFileSource(DRESDEN, a.file)),
      wallSourceFile(DRESDEN, tile),
      kerbSourceFile(DRESDEN, tile),
      stairSourceFile(DRESDEN, tile),
      terraceSourceFile(DRESDEN, tile),
      cityMeshSourceFiles(DRESDEN, tile).city,
      cityMeshSourceFiles(DRESDEN, tile).roofColor,
      cityMeshSourceFiles(DRESDEN, tile).osmBuild,
      cityMeshSourceFiles(DRESDEN, tile).smallBuild,
      dgmSourceFiles(DRESDEN, tile).tif,
      dgmSourceFiles(DRESDEN, tile).tfw,
    ];
    missing.push(...files.filter((f) => !existsSync(join(ROOT, f))));
  }
  expect(missing).toEqual([]);
});
