/**
 * Plan 090, phase 1 — what a tile's trees weigh as the tables published
 * (lib/city/tree-table.ts: what was measured, twelve or twenty bytes a
 * tree, split between the two levels' dressing files) against the same
 * trees as the stand records the vertex stage places them from
 * (lib/city/tree-stands.ts: the layout a set draws with), had those been
 * the file. Gzip 9, as the files are published; the plan's watched tiles.
 * The figures of the files these replaced are the ledger's of the commit
 * before (plan 090, *Findings*, phase 0).
 *
 *   bun scripts/eval/tree-table-bytes.ts
 *
 * Writes .cache/ledger-dressing/trees.json; `bun run ledger` folds it
 * into the ledger's `dressing.recorded.trees`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { gunzipSync } from "node:zlib";
import { unpackDressing } from "../../lib/city/dressing-pack";
import type { DressingPack } from "../../lib/city/dressing-pack";
import { ledgerTiles } from "../../lib/city/ledger";
import { DRESSING_TILES } from "../../lib/city/ledger-dressing";
import { packStands, standOrigin } from "../../lib/city/stand-record";
import type { Stand } from "../../lib/city/stand-record";
import { bucketByCell } from "../../lib/city/tree-placement";
import {
  placementStand,
  registerCrownStand,
  registerTrunkStand,
} from "../../lib/city/tree-stands";
import {
  placedTrees,
  registerFacts,
  registerTree,
} from "../../lib/city/tree-table";
import { REFERENCE_SITE } from "../../sites";
import { publishedFiles } from "../ledger";
import { DRESSING_SCRATCH } from "../ledger-dressing";

const gz = (bytes: Uint8Array): number =>
  Bun.gzipSync(bytes as Uint8Array<ArrayBuffer>, {
    level: 9,
    library: "libdeflate",
  }).length;

/** The lobed crown's box (app/_components/vegetation-layer.ts
 *  `buildCrownGeo`, as tree-inventory-layer.ts fits to it): near enough
 *  for a file's weight. */
const BROAD_FIT = { height: 4.6, minY: 1.8, width: 5.1 };

/** `stands` as tables by vegetation chunk, in one buffer. */
function standBytes(stands: (Stand & { x: number; z: number })[]): Uint8Array {
  const tables = bucketByCell(stands).map((cell) =>
    packStands(cell, standOrigin(cell))
  );
  const out = new Uint8Array(tables.reduce((n, t) => n + t.byteLength, 0));
  let at = 0;
  for (const t of tables) {
    out.set(new Uint8Array(t.buffer, t.byteOffset, t.byteLength), at);
    at += t.byteLength;
  }
  return out;
}

function measure(tile: string, what: string) {
  const published = publishedFiles(REFERENCE_SITE);
  const { offset } = (published.tileset as { extras: { offset: never } })
    .extras;
  const found = ledgerTiles(published.tileset).find((t) => t.id === tile);
  if (!found) {
    throw new Error(`no tile ${tile}`);
  }
  const fineName = (found.terrain[0].extras.dressing as { dressing: string })
    .dressing;
  const coarseName = (
    found.terrain[1].extras.coarse as { dressingCoarse: string }
  ).dressingCoarse;
  const read = (name: string): { pack: DressingPack; wire: number } => {
    const served = published.read(name);
    const raw = new Uint8Array(gunzipSync(served));
    const pack = unpackDressing(raw.buffer);
    if (!pack) {
      throw new Error(`${name}: not a dressing pack`);
    }
    return { pack, wire: served.length };
  };
  const fine = read(fineName);
  const coarse = read(coarseName);
  const packs = [coarse.pack, fine.pack];
  const trees = placedTrees(packs, offset).map((t) => t.p);
  const register = registerFacts(packs).map((f) => registerTree(f, offset, 0));
  // every tree as the vertex stage reads it: a crown's record, and a
  // surveyed tree's trunk
  const asStands = gz(
    standBytes([
      ...trees.map((p) => placementStand(p)),
      ...register.map((t) => registerCrownStand(t, BROAD_FIT)),
      ...register.map((t) => registerTrunkStand(t)),
    ])
  );
  return {
    tile,
    what,
    trees: trees.length,
    register: register.length,
    // the tables as published: what was measured
    table: {
      fine: fine.wire,
      coarse: coarse.wire,
      both: fine.wire + coarse.wire,
    },
    // the same trees as stand records, one file for both levels
    asStandRecords: asStands,
  };
}

const result = {
  read: new Date().toISOString().slice(0, 10),
  tiles: DRESSING_TILES.map(({ tile, what }) => measure(tile, what)),
};
mkdirSync(DRESSING_SCRATCH, { recursive: true });
writeFileSync(
  nodePath.join(DRESSING_SCRATCH, "trees.json"),
  `${JSON.stringify(result, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
