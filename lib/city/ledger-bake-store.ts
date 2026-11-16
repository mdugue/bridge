/**
 * The ledger's `bakeStore` section (plan 092; plan 086's "Less
 * complexity"): what the bakes hand over and how they reach across a
 * tile's edge, counted so that each phase of plan 092 shows as a figure
 * that fell. Pure functions of names and texts the caller reads
 * (scripts/ledger-bake-store.ts); every figure is a function of the tree —
 * of the bake modules and of the baked files that lie in it — and none
 * needs a bake to have run. (Which step writes into another's file is in
 * a bake's manifests only: it stays in the plan's Findings.)
 */
import { codeLines, lexPy } from "./source-lexer";
import type { SourceText } from "./source-lexer";

/** A baked file's name: its kind, the tile it is of, its format. */
const TILE_FILE = /^(?<kind>.+?)_\d+_\d+_\d+_[a-z]+\.(?<format>[^.]+)$/u;

/** Strings by their code units: no locale reorders a gated figure. */
const codeOrder = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const formatOf = (kind: string): string =>
  kind.slice(kind.lastIndexOf(".") + 1);

/**
 * The kinds of file a tile hands over, by format: the distinct
 * `<kind>.<format>` among the names given (a site's `dlm/` and `dop/`),
 * whatever the tile — the union over the names: a site may lack a kind
 * another has. `landcover_<tile>.png` and `landcover_<tile>.json` are two
 * kinds.
 *
 * Cannot see: a file not named for a tile (a site's `landmark-facts.json`),
 * nor the fetch's own files (`cityjson/`, `dgm/`), which no bake step
 * writes.
 */
export function handedOverKinds(names: readonly string[]): {
  byFormat: Record<string, number>;
  formats: number;
  total: number;
} {
  const kinds = new Set<string>();
  for (const name of names) {
    const found = TILE_FILE.exec(name)?.groups;
    if (found) {
      kinds.add(`${found.kind}.${found.format}`);
    }
  }
  const byFormat: Record<string, number> = {};
  for (const format of [...kinds].map(formatOf).toSorted(codeOrder)) {
    byFormat[format] = (byFormat[format] ?? 0) + 1;
  }
  return {
    total: kinds.size,
    formats: Object.keys(byFormat).length,
    byFormat,
  };
}

/** The bake modules among the sources handed in. */
const bakeModules = (files: readonly SourceText[]): SourceText[] =>
  files.filter(({ path }) => /(?:^|\/)pipeline\/bake\/.+\.py$/u.test(path));

/** A call of `Tile.neighbours()`: every tile of the site, to read what
 *  lies beyond the edge. */
export const NEIGHBOURS_CALL = /\.neighbours\s*\(/u;

/**
 * How many bake modules hold a call that `pattern` matches — in code,
 * never in a comment, a docstring or a string. (The modules that call
 * `owns` are `counters.bakeSeamModules.ways.owns`, ledger-counters.ts: no
 * second leaf here.)
 */
export function callingModules(
  files: readonly SourceText[],
  pattern: RegExp
): number {
  return bakeModules(files).filter(({ text }) => pattern.test(lexPy(text).bare))
    .length;
}

/** The step cache's lines of code (no comment, no blank line; a docstring
 *  is code to Python and is counted): plan 092's phase 2 takes the
 *  rewrites' ledger out of it. 0 where the module is not among `files`. */
export function stepCacheLines(files: readonly SourceText[]): number {
  const cache = files.find(({ path }) =>
    /(?:^|\/)pipeline\/bake\/step_cache\.py$/u.test(path)
  );
  return cache ? codeLines(lexPy(cache.text)) : 0;
}

/**
 * Collects the order in which each kind's rows write their keys — over
 * every row handed in, so over all sites: a kind whose sites each keep
 * one order, but not the same one, is named too — and names the kinds
 * that have no single order: two keys written one way
 * round in one row and the other way in another, or more keys in a circle. Plan 092's phase 4 reads
 * rows "in the schema's key order, which is the files' order" — true of a
 * kind only while it is not named here.
 */
export class KeyOrders {
  private readonly before = new Map<string, Set<string>>();
  private readonly seen = new Map<string, Set<string>>();

  /** One row's keys, in the order its file writes them. */
  add(kind: string, keys: readonly string[]): void {
    const signature = keys.join("\u0000");
    let seen = this.seen.get(kind);
    if (!seen) {
      seen = new Set();
      this.seen.set(kind, seen);
    }
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    let before = this.before.get(kind);
    if (!before) {
      before = new Set();
      this.before.set(kind, before);
    }
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        before.add(`${keys[i]}\u0000${keys[j]}`);
      }
    }
  }

  /** The kinds with no single key order, sorted. */
  mixed(): string[] {
    return [...this.before]
      .filter(([, before]) => hasCycle(before))
      .map(([kind]) => kind)
      .toSorted(codeOrder);
  }
}

/** Whether "a is written before b" pairs go round in a circle: then no
 *  one order writes every row as it is. */
function hasCycle(before: ReadonlySet<string>): boolean {
  const after = new Map<string, string[]>();
  for (const pair of before) {
    const [a, b] = pair.split("\u0000");
    after.set(a, [...(after.get(a) ?? []), b]);
  }
  // 1 on the path being walked, 2 done
  const state = new Map<string, 1 | 2>();
  const walk = (key: string): boolean => {
    if (state.get(key) === 1) {
      return true;
    }
    if (state.get(key) === 2) {
      return false;
    }
    state.set(key, 1);
    const round = (after.get(key) ?? []).some(walk);
    state.set(key, 2);
    return round;
  };
  return [...after.keys()].some(walk);
}

/** `qa/ledger.json`'s `bakeStore` section. */
export interface BakeStoreLedger {
  /** the kinds of file a tile hands over: the union over every site
   *  whose baked files git tracks */
  fileKinds: ReturnType<typeof handedOverKinds>;
  /** the feature kinds whose rows, over all sites, have no single key
   *  order */
  mixedKeyOrder: string[];
  /** bake modules that call `Tile.neighbours()` */
  neighboursModules: number;
  /** the sites whose baked files were read */
  sites: string[];
  stepCacheCodeLines: number;
}

/** The section, from the bake modules, the names of the baked files and
 *  the key orders collected from the feature files. */
export function bakeStoreLedger(
  sites: readonly string[],
  bake: readonly SourceText[],
  baked: readonly string[],
  orders: KeyOrders
): BakeStoreLedger {
  return {
    sites: sites.toSorted(codeOrder),
    fileKinds: handedOverKinds(baked),
    mixedKeyOrder: orders.mixed(),
    stepCacheCodeLines: stepCacheLines(bake),
    neighboursModules: callingModules(bake, NEIGHBOURS_CALL),
  };
}
