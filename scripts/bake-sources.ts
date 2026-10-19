/**
 * What the build cache keys on: the bake's own sources, found by walking the
 * repo's own imports from its entry point (so a module the bake starts to
 * import can never be missing from the key), the versions the lockfile
 * resolved for the packages those sources import (so a bump of a package
 * only the viewer imports re-bakes nothing), and file contents rather than
 * mtimes (so a checkout or a touch alone does not re-bake, and an edit
 * always does).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

const TS = new Bun.Transpiler({ loader: "ts" });
const TSX = new Bun.Transpiler({ loader: "tsx" });

/** Per extension: the tsx loader reads `<T>(x) =>` as JSX. */
const transpilerFor = (file: string) => (file.endsWith(".tsx") ? TSX : TS);

/** A file's import specifiers (type-only imports left out: they do not
 *  run). */
function importsOf(file: string, transpiler: Bun.Transpiler): string[] {
  return transpiler
    .scanImports(readFileSync(file, "utf8"))
    .map(({ path }) => path);
}

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
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const path of importsOf(file, transpilerFor(file))) {
      const next = resolveImport(file, path, resolve(root));
      if (next && !seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return [...seen].map((file) => relative(root, file)).toSorted();
}

/** The package a bare specifier names (`three/addons/x` → `three`,
 *  `@scope/name/x` → `@scope/name`); null for a relative or `@/` import
 *  and for Node's and Bun's own modules. */
function packageOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("@/") || isBuiltin(spec)) {
    return null;
  }
  const parts = spec.split("/");
  return spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** The packages one source file imports itself (not through the repo's
 *  modules it imports), sorted. */
export function packageImports(file: string): string[] {
  const names = importsOf(file, transpilerFor(file))
    .map(packageOf)
    .filter((name) => name !== null);
  return [...new Set(names)].toSorted();
}

/** bun.lock's `packages`: a package's key (its name, or for a copy nested
 *  under another the path of names, `parent/name`) → its entry
 *  (resolution, registry, its dependencies, integrity). */
export type LockedPackages = Readonly<Record<string, readonly unknown[]>>;

/** The `packages` of a bun.lock's text. */
export function readLockfile(text: string): LockedPackages {
  const lock = Bun.JSONC.parse(text) as { packages?: LockedPackages };
  if (!lock.packages) {
    throw new Error("bake-sources: the lockfile has no packages");
  }
  return lock.packages;
}

/** A key's path of package names (`@a/b/c` → `@a/b`, `c`). */
function namesOf(key: string): string[] {
  const parts = key.split("/");
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    names.push(
      parts[i].startsWith("@") ? `${parts[i]}/${parts[++i]}` : parts[i]
    );
  }
  return names;
}

/** The copy of `name` the package at `key` gets: the one nested nearest
 *  under it or its parents, else the hoisted one. */
function dependencyKey(
  lock: LockedPackages,
  key: string,
  name: string
): string | undefined {
  const path = namesOf(key);
  for (let i = path.length; i >= 0; i--) {
    const candidate = [...path.slice(0, i), name].join("/");
    if (lock[candidate]) {
      return candidate;
    }
  }
  return undefined;
}

/** What a lockfile entry depends on, and whether the lockfile must hold
 *  it: its dependencies must, its optional ones and peers count where it
 *  does. Not the type packages (`@types/…`): they hold no code. */
function dependenciesOf(
  entry: readonly unknown[]
): { name: string; required: boolean }[] {
  const meta = entry.find(
    (part) => typeof part === "object" && part !== null && !Array.isArray(part)
  ) as Partial<Record<string, Record<string, string>>> | undefined;
  const of = (field: string, required: boolean) =>
    Object.keys(meta?.[field] ?? {}).map((name) => ({ name, required }));
  return [
    ...of("dependencies", true),
    ...of("optionalDependencies", false),
    ...of("peerDependencies", false),
  ].filter(({ name }) => !name.startsWith("@types/"));
}

/**
 * The lockfile's entries for `packages` and everything they depend on, one
 * line per package (its key and whole entry: resolution, dependencies,
 * integrity), sorted — what a bump of any of them changes. A package or a
 * dependency the lockfile does not hold fails rather than dropping out of
 * the key without a word.
 */
export function lockedVersions(
  lock: LockedPackages,
  packages: Iterable<string>
): string[] {
  const queue = [...packages];
  for (const name of queue) {
    if (!lock[name]) {
      throw new Error(`bake-sources: "${name}" is not in the lockfile`);
    }
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const key = queue.pop() as string;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    for (const { name, required } of dependenciesOf(lock[key])) {
      const dep = dependencyKey(lock, key, name);
      if (dep) {
        queue.push(dep);
      } else if (required) {
        throw new Error(
          `bake-sources: "${name}", a dependency of "${key}", is not in the lockfile`
        );
      }
    }
  }
  return [...seen]
    .toSorted()
    .map((key) => `${key} ${JSON.stringify(lock[key])}`);
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
