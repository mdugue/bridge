/**
 * Reads the ledger's `bakeStore` section (plan 092) from the tree: the
 * bake modules under pipeline/bake/ and the baked files of every site
 * that has them under data/<site>/dlm/ and dop/. The counting is
 * lib/city/ledger-bake-store.ts; scripts/ledger.ts writes the result into
 * `qa/ledger.json`. It reads no published file and needs no build.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { bakeStoreLedger, KeyOrders } from "../lib/city/ledger-bake-store";
import type { BakeStoreLedger } from "../lib/city/ledger-bake-store";
import type { SourceText } from "../lib/city/source-lexer";

/** Where the bakes lie, and where a site's baked files do. */
const BAKE_ROOT = "pipeline/bake";
const DATA_ROOT = "data";
const BAKED_FOLDERS = ["dlm", "dop"] as const;

/** The bake modules of the tree at `root`, at any depth. */
function bakeSources(root: string): SourceText[] {
  const dir = nodePath.join(root, BAKE_ROOT);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => name.endsWith(".py"))
    .toSorted()
    .map((name) => ({
      path: `${BAKE_ROOT}/${name}`,
      text: readFileSync(nodePath.join(dir, name), "utf-8"),
    }));
}

/** The sites whose baked files are in the tree: every folder of `data/`
 *  with a `dlm/` (the raw downloads, `_raw/`, have none). */
function bakedSites(root: string): string[] {
  const dir = nodePath.join(root, DATA_ROOT);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(nodePath.join(dir, entry.name, "dlm"))
    )
    .map((entry) => entry.name)
    .toSorted();
}

/** A feature file's kind: its name before the tile's id. */
const kindOf = (name: string): string =>
  /^(?<kind>.+?)_\d+_\d+_\d+_[a-z]+\./u.exec(name)?.groups?.kind ?? name;

interface Features {
  features?: { properties?: Record<string, unknown> | null }[];
}

/** The `bakeStore` section of the tree at `root`. */
export function measureBakeStore(root: string): BakeStoreLedger {
  const sites = bakedSites(root);
  const baked: string[] = [];
  const orders = new KeyOrders();
  for (const site of sites) {
    for (const folder of BAKED_FOLDERS) {
      const dir = nodePath.join(root, DATA_ROOT, site, folder);
      if (!existsSync(dir)) {
        continue;
      }
      for (const name of readdirSync(dir).toSorted()) {
        baked.push(name);
        if (name.endsWith(".geojson")) {
          // reason: only the keys' order is read, of whatever the rows hold
          const doc = JSON.parse(
            readFileSync(nodePath.join(dir, name), "utf-8")
          ) as Features;
          for (const feature of doc.features ?? []) {
            orders.add(kindOf(name), Object.keys(feature.properties ?? {}));
          }
        }
      }
    }
  }
  return bakeStoreLedger(sites, bakeSources(root), baked, orders);
}
