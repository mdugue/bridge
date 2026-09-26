/**
 * What the build cache keys on: the bake's own sources, found by walking the
 * repo's own imports from its entry point (so a module the bake starts to
 * import can never be missing from the key), and file contents rather than
 * mtimes (so a checkout or a touch alone does not re-bake, and an edit
 * always does).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** The file a relative or `@/` specifier names (tsconfig maps `@/*` to the
 *  repo root), or null for a package import. */
function resolveImport(
  from: string,
  spec: string,
  root: string
): string | null {
  let base: string;
  if (spec.startsWith(".")) {
    base = resolve(dirname(from), spec);
  } else if (spec.startsWith("@/")) {
    base = resolve(root, spec.slice(2));
  } else {
    return null;
  }
  if (existsSync(base) && statSync(base).isFile()) {
    return base;
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) {
      return base + ext;
    }
  }
  throw new Error(`bake-sources: cannot resolve "${spec}" from ${from}`);
}

/**
 * Every source file reachable from `entry` through relative and `@/` imports,
 * `entry` included, as paths relative to `root`, sorted.
 */
export function moduleGraph(entry: string, root = process.cwd()): string[] {
  // Per extension: the tsx loader reads `<T>(x) =>` as JSX.
  const ts = new Bun.Transpiler({ loader: "ts" });
  const tsx = new Bun.Transpiler({ loader: "tsx" });
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const code = readFileSync(file, "utf8");
    const transpiler = file.endsWith(".tsx") ? tsx : ts;
    for (const { path } of transpiler.scanImports(code)) {
      const next = resolveImport(file, path, resolve(root));
      if (next && !seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return [...seen].map((file) => relative(root, file)).toSorted();
}

/** Content hashes, memoised per path for one process (a bake run). */
export function createContentHasher(): (path: string) => string {
  const memo = new Map<string, string>();
  return (path) => {
    let hash = memo.get(path);
    if (hash === undefined) {
      hash = existsSync(path)
        ? createHash("sha1").update(readFileSync(path)).digest("hex")
        : "absent";
      memo.set(path, hash);
    }
    return hash;
  };
}

/** A cache key over the contents of `files` and any extra values. */
export function contentKey(
  hashOf: (path: string) => string,
  files: readonly string[],
  extra: readonly unknown[]
): string {
  const h = createHash("sha1");
  for (const path of files) {
    h.update(`${path}:${hashOf(path)};`);
  }
  h.update(JSON.stringify(extra));
  return h.digest("hex").slice(0, 12);
}
