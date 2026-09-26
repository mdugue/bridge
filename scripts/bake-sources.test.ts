import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentKey, createContentHasher, moduleGraph } from "./bake-sources";

describe("moduleGraph", () => {
  test("reaches every module the bake imports, transitively", () => {
    const graph = moduleGraph("scripts/prepare-data.ts");
    // The ones a hand-kept list once missed: each shapes every tile.
    for (const path of [
      "scripts/prepare-data.ts",
      "scripts/bake-tiles.ts",
      "scripts/bake-city-mesh.ts",
      "lib/city/tfw.ts",
      "lib/city/crs.ts",
      "lib/city/recenter.ts",
      "lib/city/landcover.ts",
      "sites/dresden.ts",
    ]) {
      expect(graph).toContain(path);
    }
    expect(graph.every((path) => !path.includes("node_modules"))).toBe(true);
  });

  test("follows relative imports only", () => {
    const dir = mkdtempSync(join(tmpdir(), "bake-sources-"));
    writeFileSync(join(dir, "a.ts"), 'import "./b";\nimport "three";\n');
    writeFileSync(join(dir, "b.ts"), 'export * from "./c/index";\n');
    writeFileSync(join(dir, "c.ts"), "");
    expect(() => moduleGraph("a.ts", dir)).toThrow("cannot resolve");
    writeFileSync(join(dir, "b.ts"), "export const b = 1;\n");
    expect(moduleGraph("a.ts", dir)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("contentKey", () => {
  test("changes with a file's content, not its mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "bake-key-"));
    const file = join(dir, "x.ts");
    writeFileSync(file, "one");
    const first = contentKey(createContentHasher(), [file], []);
    writeFileSync(file, "one");
    expect(contentKey(createContentHasher(), [file], [])).toBe(first);
    writeFileSync(file, "two");
    expect(contentKey(createContentHasher(), [file], [])).not.toBe(first);
  });

  test("changes with the extra values", () => {
    const hash = createContentHasher();
    expect(contentKey(hash, [], [1])).not.toBe(contentKey(hash, [], [2]));
  });
});
