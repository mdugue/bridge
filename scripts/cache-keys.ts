import { join } from "node:path";
import {
  contentKey,
  createContentHasher,
  type LockedPackages,
  lockedVersions,
  moduleGraph,
  packageImports,
} from "./bake-sources";

/**
 * The bake cache's keys (scripts/prepare-data.ts, ADR 0003): a key covers
 * the contents of an artifact's input files, every module its bake's
 * entries reach (bake-entries.ts), the common sources every key carries,
 * the locked versions of the packages those modules import (with their
 * dependencies; not the whole lockfile, so a bump of a package only the
 * viewer imports re-bakes nothing), and any extra values. Contents and
 * graphs are read once per run.
 */
export interface KeyMaker {
  key: (
    inputs: readonly string[],
    entries: readonly string[],
    ...extra: unknown[]
  ) => string;
}

export function createKeyMaker(opts: {
  /** the repo's root: entries and their imports resolve from it */
  root: string;
  /** absolute paths every key carries */
  common: readonly string[];
  /** modules (relative to `root`) whose imports no key walks beyond
   *  (bake-entries.ts `KEY_STOPS`) */
  stop?: readonly string[];
  lockfile: LockedPackages;
}): KeyMaker {
  const hashOf = createContentHasher();
  const graphs = new Map<string, string[]>();
  const packagesIn = new Map<string, string[]>();
  const locked = new Map<string, string[]>();

  const sourcesOf = (entry: string): string[] => {
    let graph = graphs.get(entry);
    if (!graph) {
      graph = moduleGraph(entry, opts.root, opts.stop).map((p) =>
        join(opts.root, p)
      );
      graphs.set(entry, graph);
    }
    return graph;
  };

  /** The lockfile's lines for every package `sources` import, memoised
   *  per set of packages. */
  const lockedFor = (sources: Iterable<string>): string[] => {
    const packages = new Set<string>();
    for (const file of sources) {
      // the patches are no modules
      if (!/\.tsx?$/u.test(file)) {
        continue;
      }
      let own = packagesIn.get(file);
      if (!own) {
        own = packageImports(file);
        packagesIn.set(file, own);
      }
      for (const name of own) {
        packages.add(name);
      }
    }
    const names = [...packages].toSorted();
    let lines = locked.get(names.join(" "));
    if (!lines) {
      lines = lockedVersions(opts.lockfile, names);
      locked.set(names.join(" "), lines);
    }
    return lines;
  };

  return {
    key: (inputs, entries, ...extra) => {
      const sources = new Set<string>(opts.common);
      for (const entry of entries) {
        for (const file of sourcesOf(entry)) {
          sources.add(file);
        }
      }
      return contentKey(
        hashOf,
        [...inputs, ...[...sources].toSorted()],
        [lockedFor(sources), ...extra]
      );
    },
  };
}
