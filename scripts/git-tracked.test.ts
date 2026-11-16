import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { gitEnv, trackedFiles } from "./git-tracked";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A fresh folder outside any work tree, with `files` written into it. */
function folder(files: readonly string[] = []): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), "git-tracked-"));
  roots.push(root);
  for (const path of files) {
    const file = nodePath.join(root, path);
    mkdirSync(nodePath.dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  return root;
}

/** A work tree that tracks (stages) `files`, in git's clean environment. */
function repo(files: readonly string[]): string {
  const root = folder(files);
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
  ]) {
    const done = Bun.spawnSync(["git", ...args], { cwd: root, env: gitEnv() });
    expect(done.exitCode).toBe(0);
  }
  return root;
}

test("what git tracks under the pathspec, staged or committed", () => {
  const root = repo(["data/a/x.json", "data/b/y.png", "docs/z.md"]);
  writeFileSync(nodePath.join(root, "data/a/untracked.json"), "");
  expect(trackedFiles(root, "data")).toEqual(["data/a/x.json", "data/b/y.png"]);
});

test("a folder that is no work tree tracks nothing", () => {
  expect(trackedFiles(folder(["data/a/x.json"]), "data")).toEqual([]);
});

test("a git that fails is an error in git's words, never an empty list", () => {
  const root = folder(["data/a/x.json"]);
  // a linked worktree whose repository is gone
  writeFileSync(nodePath.join(root, ".git"), "gitdir: /no/such/repo/.git\n");
  expect(() => trackedFiles(root, "data")).toThrow(
    /git ls-files in .* failed: .*not a git repository/u
  );
});

test("git's variables of the caller do not point it at another repository", () => {
  const ours = repo(["data/a/x.json"]);
  const theirs = repo(["data/b/y.png"]);
  const saved = { ...process.env };
  process.env.GIT_DIR = nodePath.join(theirs, ".git");
  process.env.GIT_INDEX_FILE = nodePath.join(theirs, ".git/index");
  try {
    expect(gitEnv().GIT_DIR).toBeUndefined();
    expect(trackedFiles(ours, "data")).toEqual(["data/a/x.json"]);
  } finally {
    process.env.GIT_DIR = saved.GIT_DIR;
    process.env.GIT_INDEX_FILE = saved.GIT_INDEX_FILE;
    if (saved.GIT_DIR === undefined) {
      delete process.env.GIT_DIR;
    }
    if (saved.GIT_INDEX_FILE === undefined) {
      delete process.env.GIT_INDEX_FILE;
    }
  }
});
