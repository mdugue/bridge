/**
 * Reads the ledger's `bakeStore` section (plan 092) from the tree: the
 * bake modules under pipeline/bake/ and the baked files git tracks under
 * data/<site>/dlm/ and dop/ (every committed site). The counting is
 * lib/city/ledger-bake-store.ts; scripts/ledger.ts writes the result into
 * `qa/ledger.json`. It reads no published file and needs no build.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { bakeStoreLedger, KeyOrders } from "../lib/city/ledger-bake-store";
import type { BakeStoreLedger } from "../lib/city/ledger-bake-store";
import type { SourceText } from "../lib/city/source-lexer";
import { trackedFiles } from "./git-tracked";

/** Where the bakes lie, and where a site's baked files do. */
const BAKE_ROOT = "pipeline/bake";
const DATA_ROOT = "data";

/** The bake modules of the tree at `root`, at any depth. */
function bakeSources(root: string): SourceText[] {
  const dir = nodePath.join(root, BAKE_ROOT);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => name.endsWith(".py"))
    .map((name) => ({
      path: `${BAKE_ROOT}/${name}`,
      text: readFileSync(nodePath.join(dir, name), "utf-8"),
    }));
}

/** A baked file as git tracks it: `data/<site>/dlm|dop/<name>`. */
const BAKED_FILE = /^data\/(?<site>[^/]+)\/(?:dlm|dop)\/(?<name>[^/]+)$/u;

/**
 * The baked files git tracks under `root`, as (site, name, path). Tracked,
 * not what lies on the disk: a site that is fetched and baked but not
 * committed (`data/` is ignored but for the committed sites) and a file an
 * interrupted bake left behind are no figure of the tree. None where
 * `root` is no work tree; a git that fails otherwise is an error
 * (`trackedFiles`).
 */
export function trackedBaked(
  root: string
): { name: string; path: string; site: string }[] {
  return trackedFiles(root, DATA_ROOT).flatMap((path) => {
    const found = BAKED_FILE.exec(path)?.groups;
    return found ? [{ site: found.site, name: found.name, path }] : [];
  });
}

/** A feature file's kind: its name before the tile's id. */
const kindOf = (name: string): string =>
  /^(?<kind>.+?)_\d+_\d+_\d+_[a-z]+\./u.exec(name)?.groups?.kind ?? name;

interface Features {
  features?: { properties?: Record<string, unknown> | null }[];
}

/** The `bakeStore` section of the tree at `root`. */
export function measureBakeStore(root: string): BakeStoreLedger {
  const files = trackedBaked(root);
  const orders = new KeyOrders();
  for (const { name, path } of files) {
    if (name.endsWith(".geojson")) {
      // reason: only the keys' order is read, of whatever the rows hold
      const doc = JSON.parse(
        readFileSync(nodePath.join(root, path), "utf-8")
      ) as Features;
      for (const feature of doc.features ?? []) {
        orders.add(kindOf(name), Object.keys(feature.properties ?? {}));
      }
    }
  }
  return bakeStoreLedger(
    [...new Set(files.map((file) => file.site))],
    bakeSources(root),
    files.map((file) => file.name),
    orders
  );
}
