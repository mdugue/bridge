import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DRESDEN } from "../../sites/dresden";
import {
  cityMeshSourceFiles,
  dgmSourceFiles,
  kerbSourceFile,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  tileIds,
  wallSourceFile,
} from "./tile";

// Every tile of the site carries the same baked data. An optional artifact
// that is missing is not an error anywhere else — prepare-data leaves it
// out and the layer stays off — so a bake step run on some tiles only (a new
// step from main, a tile added later) would ship as a quietly poorer part of
// the city. This is where it fails instead: add the tile to the site, run
// `bun run bake <tile> --ingest`, and this test says what is still missing.

const ROOT = join(import.meta.dir, "..", "..");
const TILES = tileIds(DRESDEN);
const TILE_IN_NAME = /_(33\d{3}_\d{4}_2_sn)(.*)$/;

/**
 * Artifact kinds a tile may lack for a reason in the data, not in the bake.
 * Keep this short and say why; "not baked yet" is never a reason.
 */
const MAY_LACK: Record<string, string> = {};

/** `<kind><suffix>` → the tiles that carry it, over the per-tile folders. */
function kindsOnDisk(): Map<string, Set<string>> {
  const kinds = new Map<string, Set<string>>();
  for (const dir of ["data/dlm", "data/dop"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
      const m = TILE_IN_NAME.exec(name);
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

test("no baked file belongs to a tile outside the site", () => {
  const strays = [...kindsOnDisk()].flatMap(([kind, tiles]) =>
    [...tiles].filter((t) => !TILES.includes(t)).map((t) => `${kind} ${t}`)
  );
  expect(strays).toEqual([]);
});

test("every kind of baked file that one tile has, every tile has", () => {
  const missing: string[] = [];
  for (const [kind, tiles] of kindsOnDisk()) {
    const base = kind.split("/").pop()?.split("_*")[0] ?? kind;
    if (base in MAY_LACK) {
      continue;
    }
    for (const tile of TILES) {
      if (!tiles.has(tile)) {
        missing.push(`${kind.replace("*", tile)}`);
      }
    }
  }
  expect(missing).toEqual([]);
});

test("every tile has every artifact the viewer reads and every bake input", () => {
  const missing: string[] = [];
  for (const tile of TILES) {
    const files = [
      ...Object.entries(tileArtifacts(tile))
        // A downsampled raster is made at build time, not committed.
        .filter(([kind, a]) => !a.bakedFrom && !(kind in MAY_LACK))
        .map(([, a]) => `data/dlm/${a.file}`),
      wallSourceFile(tile),
      kerbSourceFile(tile),
      stairSourceFile(tile),
      terraceSourceFile(tile),
      cityMeshSourceFiles(tile).city,
      cityMeshSourceFiles(tile).roofColor,
      dgmSourceFiles(tile).tif,
      dgmSourceFiles(tile).tfw,
    ];
    missing.push(...files.filter((f) => !existsSync(join(ROOT, f))));
  }
  expect(missing).toEqual([]);
});
