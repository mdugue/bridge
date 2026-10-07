import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentKey, createContentHasher, moduleGraph } from "./bake-sources";

describe("moduleGraph", () => {
  test("a tile bake's graph holds its own modules, not the site configs or the palette", () => {
    const terrain = moduleGraph("scripts/bake-tiles.ts");
    for (const path of [
      "scripts/bake-tiles.ts",
      "lib/city/tfw.ts",
      "lib/city/terrain-geometry.ts",
    ]) {
      expect(terrain).toContain(path);
    }
    for (const path of [
      "sites/berlin.ts",
      "sites/dresden.ts",
      "lib/city/landcover.ts",
      "lib/city/pose.ts",
    ]) {
      expect(terrain).not.toContain(path);
    }
    const city = moduleGraph("scripts/bake-city-mesh.ts");
    expect(city).toContain("lib/city/city-mesh.ts");
    expect(city).not.toContain("sites/berlin.ts");
    expect(moduleGraph("scripts/bake-wissen-hero.ts")).toContain(
      "lib/city/landcover.ts"
    );
    expect(terrain.every((path) => !path.includes("node_modules"))).toBe(true);
  });

  test("no bake prepare-data keys on reaches a site config", () => {
    // The CLI that does lives beside it (scripts/line-levels-cli.ts).
    for (const entry of [
      "scripts/line-levels.ts",
      "scripts/coarse-crowns.ts",
      "scripts/tile-sources.ts",
      "scripts/tile-glb.ts",
      "scripts/downsample-raster.ts",
      "scripts/crop-raster.ts",
    ]) {
      expect(
        moduleGraph(entry).filter((path) => path.startsWith("sites/"))
      ).toEqual([]);
    }
  });

  test("follows relative and @/ imports, not packages", () => {
    const dir = mkdtempSync(join(tmpdir(), "bake-sources-"));
    writeFileSync(join(dir, "a.ts"), 'import "./b";\nimport "three";\n');
    writeFileSync(join(dir, "b.ts"), 'export * from "./c/index";\n');
    writeFileSync(join(dir, "c.ts"), "");
    expect(() => moduleGraph("a.ts", dir)).toThrow("cannot resolve");
    writeFileSync(join(dir, "b.ts"), 'import "@/d";\nexport const b = 1;\n');
    writeFileSync(join(dir, "d.ts"), "");
    expect(moduleGraph("a.ts", dir)).toEqual(["a.ts", "b.ts", "d.ts"]);
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
