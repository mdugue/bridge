/**
 * The ledger's `dressing` section (plan 090, phase 0;
 * lib/city/ledger-dressing.ts has its shapes): the watched tiles' dressing
 * by kind from the reference site's published files — gated — and the
 * recorded part, `dressing.recorded`, which the check never compares: the
 * committed one, with whatever the measuring tools left in the scratch
 * folder since (e2e/dressing-ledger.spec.ts, scripts/eval/) folded in on a
 * write, and München's watched tile where that site is built. A machine
 * that measured nothing writes the recorded part back as it was.
 */
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { ledgerDiff, ledgerTiles, wireBytes } from "../lib/city/ledger";
import {
  DRESSING_RECORDED_NOTE,
  DRESSING_TILES,
  dressingTiles,
} from "../lib/city/ledger-dressing";
import type {
  DressingLedger,
  DressingRecorded,
} from "../lib/city/ledger-dressing";
import { MANIFEST_FILE } from "../lib/city/tile";
import type { PublishedFiles } from "./ledger";

/** Where the dressing's measuring tools leave what they read, under the
 *  repository's root: gitignored scratch. */
export const DRESSING_SCRATCH_PATH = ".cache/ledger-dressing";
export const DRESSING_SCRATCH = nodePath.join(
  import.meta.dir,
  "..",
  DRESSING_SCRATCH_PATH
);

/** Another site's watched tile, recorded only. */
const MUENCHEN = {
  site: "muenchen",
  tile: "32690_5334_2_by",
  what: "heaviest",
};

type Publish = (site: string, root: string) => PublishedFiles;

/** A site's watched tiles, weighed as the ledger weighs a file. */
function tilesOf(
  published: PublishedFiles,
  wanted: readonly { tile: string; what: string }[]
): DressingLedger["tiles"] {
  const wire = (served: string) => wireBytes(served, published.read(served));
  return dressingTiles(ledgerTiles(published.tileset), wanted, wire);
}

function muenchen(
  was: unknown,
  root: string,
  today: string,
  publish: Publish
): unknown {
  const manifest = nodePath.join(
    root,
    "public/data",
    MUENCHEN.site,
    MANIFEST_FILE
  );
  if (!existsSync(manifest)) {
    return was;
  }
  const tiles = tilesOf(publish(MUENCHEN.site, root), [MUENCHEN]);
  const kept = was as { tiles?: unknown } | undefined;
  return ledgerDiff(kept?.tiles ?? {}, tiles, []).length === 0
    ? was
    : { read: today, tiles };
}

/** The recorded part to write. */
function recorded(
  was: DressingRecorded | undefined,
  root: string,
  today: string,
  publish: Publish
): DressingRecorded {
  const fold = (key: "browser" | "lines" | "stands") => {
    const file = nodePath.join(root, DRESSING_SCRATCH_PATH, `${key}.json`);
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf-8")) as unknown)
      : was?.[key];
  };
  const out: DressingRecorded = { note: DRESSING_RECORDED_NOTE };
  const members = {
    muenchen: muenchen(was?.muenchen, root, today, publish),
    browser: fold("browser"),
    stands: fold("stands"),
    lines: fold("lines"),
  };
  for (const [key, value] of Object.entries(members)) {
    if (value !== undefined) {
      out[key as keyof typeof members] = value;
    }
  }
  return out;
}

/**
 * The section for `site`: its gated tiles, and — where `committed` (the
 * ledger as committed) is handed in for a write — the recorded part.
 */
export function measureDressing(
  site: string,
  root: string,
  publish: Publish,
  write?: { committed: unknown; today: string }
): DressingLedger {
  const tiles = tilesOf(publish(site, root), DRESSING_TILES);
  if (!write) {
    return { tiles };
  }
  const was = (write.committed as { dressing?: DressingLedger } | null)
    ?.dressing?.recorded;
  return { tiles, recorded: recorded(was, root, write.today, publish) };
}
