/**
 * The ledger's dressing section (plan 090, phase 0): what a terrain
 * level's dressing brings over the wire, kind by kind — the side files its
 * extras name under `dressing` (a fine level) or `coarse`, and the sports
 * table the dressing fetches for its goals — for the tiles the plan
 * watches. Gated, like the sets: a function of the published files. Every
 * later phase of plan 090 reads its gate here ("a fine level's bytes not
 * larger, its requests fewer"). Pure; scripts/ledger.ts reads the files.
 *
 * Beside it, recorded and never compared (`DressingRecorded`, at
 * `dressing.recorded`): München's
 * tile (the gate builds the reference site alone), what only a browser
 * can measure — the scene thread's milliseconds by builder, the bytes the
 * dressing weighs in the tile cache — and the two spikes' figures, each
 * with the machine and the day it was read on.
 */
import type { LedgerTile } from "./ledger";

/** The reference site's tiles the plan watches, and why. */
export const DRESSING_TILES = [
  { tile: "33412_5656_2_sn", what: "spawn" },
  { tile: "33416_5658_2_sn", what: "forest" },
  { tile: "33410_5656_2_sn", what: "yards" },
] as const;

/** One level's dressing on the wire. */
export interface DressingLevel {
  bytes: number;
  /** requests: one a kind present */
  files: number;
  /** wire bytes by kind (lib/city/tile.ts `ARTIFACTS`; `sportTable` is the
   *  sports grounds' table, named beside the rasters) */
  kinds: Record<string, number>;
}

export interface DressingTile {
  coarse: DressingLevel;
  fine: DressingLevel;
  tile: string;
  /**
   * What a visit to the fine level fetches of the dressing: its own files
   * and the coarse level's dressing file it reads too (`coarseDressing`:
   * the third of the tile's trees that level draws; tile-stream.ts
   * `buildDressing`). The gate of plan 090's "a fine level's bytes not
   * larger" is this sum, not `fine` alone: a tree moved from one of the
   * two files to the other moves nothing here.
   */
  visit: { bytes: number; files: number };
  what: string;
}

type Named = Record<string, unknown>;

/** A level's dressing: the files `named` lists by kind, each weighed. */
export function dressingLevel(
  named: Named,
  wire: (file: string) => number
): DressingLevel {
  const kinds: Record<string, number> = {};
  for (const kind of Object.keys(named).toSorted()) {
    const file = named[kind];
    if (typeof file === "string" && file !== "") {
      kinds[kind] = wire(file);
    }
  }
  const sizes = Object.values(kinds);
  return {
    bytes: sizes.reduce((sum, b) => sum + b, 0),
    files: sizes.length,
    kinds,
  };
}

const record = (value: unknown): Named =>
  typeof value === "object" && value !== null ? (value as Named) : {};

/** The dressing of one tile's two levels. */
export function dressingTile(
  tile: LedgerTile,
  what: string,
  wire: (file: string) => number
): DressingTile {
  const fine = tile.terrain[0].extras;
  const own = { ...record(fine.dressing), sportTable: fine.sportTable };
  const visit = dressingLevel(
    { ...own, coarseDressing: fine.coarseDressing },
    wire
  );
  return {
    tile: tile.id,
    what,
    fine: dressingLevel(own, wire),
    coarse: dressingLevel(record(tile.terrain[1].extras.coarse), wire),
    visit: { bytes: visit.bytes, files: visit.files },
  };
}

/** The watched tiles' dressing, each under what it is watched for
 *  (`spawn`, `forest`, `yards`: every figure a named leaf, so the check
 *  names the one that moved); a tile the site lacks is left out. */
export function dressingTiles(
  tiles: readonly LedgerTile[],
  wanted: readonly { tile: string; what: string }[],
  wire: (file: string) => number
): Record<string, DressingTile> {
  const out: Record<string, DressingTile> = {};
  for (const { tile, what } of wanted) {
    const found = tiles.find((t) => t.id === tile);
    if (found) {
      out[what] = dressingTile(found, what, wire);
    }
  }
  return out;
}

/** The ledger's `dressing` section: the gated tiles, and the recorded
 *  part (`dressing.recorded`, in the ledger's `UNCOMPARED`). */
export interface DressingLedger {
  recorded?: DressingRecorded;
  tiles: Record<string, DressingTile>;
}

/** The path of the part the check never compares. */
export const DRESSING_UNCOMPARED = "dressing.recorded";

/** What the gate never compares (see the head). Each member is written by
 *  the tool that measured it and kept until measured again. */
export interface DressingRecorded {
  /** e2e/dressing-ledger.spec.ts, by run tag */
  browser?: unknown;
  /** scripts/eval/lines-three-ways.ts */
  lines?: unknown;
  /** another site's watched tile (its published files, where built) */
  muenchen?: unknown;
  note: string;
  /** scripts/eval/tree-table-bytes.ts: the trees' tables against the
   *  same trees as stand records (plan 090, phase 1) */
  trees?: unknown;
  /** scripts/eval/stand-record-probe.ts, and phase 0's bytes of a coarse
   *  level's crowns as records (its tool went with the file it read) */
  stands?: unknown;
}

export const DRESSING_RECORDED_NOTE =
  "Recorded, never compared (plan 090, phase 0): a browser's timings and cache bytes on a software renderer say which builder is heavy, not what a phone pays; the spikes' figures are those of the day and machine named in each.";
