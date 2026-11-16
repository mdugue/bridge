/**
 * The files git tracks under a root, for the ledger's figures that must be
 * functions of the committed tree (the `rasters` and `blocks` sites,
 * scripts/ledger-rasters.ts; the bake store, scripts/ledger-bake-store.ts).
 * Read from git's index, so a staged file counts as tracked. The paths are
 * relative to `root`, which is the repository's top where the ledger runs.
 */
import { existsSync } from "node:fs";
import nodePath from "node:path";

/** The environment without git's own variables: a `GIT_DIR` or
 *  `GIT_INDEX_FILE` a hook or `git rebase -x` exported would point git at
 *  another repository than the one under `root`. */
export function gitEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        !entry[0].startsWith("GIT_") && entry[1] !== undefined
    )
  );
}

/** Whether `root` lies in a work tree: a `.git` (folder, or the file of a
 *  linked worktree) in it or a folder above. */
function inWorkTree(root: string): boolean {
  let dir = nodePath.resolve(root);
  for (;;) {
    if (existsSync(nodePath.join(dir, ".git"))) {
      return true;
    }
    const up = nodePath.dirname(dir);
    if (up === dir) {
      return false;
    }
    dir = up;
  }
}

/**
 * The paths git tracks under `pathspec` (relative to `root`). None where
 * `root` is no work tree (a test's fixture); any other failure of git —
 * a broken `.git`, a repository git refuses as of dubious ownership — is
 * an error with git's own words, never an empty list that a write would
 * commit as figures.
 */
export function trackedFiles(root: string, pathspec: string): string[] {
  if (!inWorkTree(root)) {
    return [];
  }
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--", pathspec], {
    cwd: root,
    env: gitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (listed.exitCode !== 0) {
    throw new Error(
      `ledger: git ls-files in ${root} failed: ${listed.stderr.toString().trim()}`
    );
  }
  return listed.stdout
    .toString()
    .split("\u0000")
    .filter((path) => path !== "");
}
