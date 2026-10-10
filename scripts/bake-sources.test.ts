import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentKey,
  createContentHasher,
  lockedVersions,
  moduleGraph,
  packageImports,
  readLockfile,
} from "./bake-sources";

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
      // the buildings' modules: a change to them re-bakes no terrain
      "lib/city/city-mesh.ts",
      "lib/city/object-facts.ts",
      "lib/city/windows.ts",
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

describe("packageImports", () => {
  test("names each package a file imports, not its own modules or Node's", () => {
    const dir = mkdtempSync(join(tmpdir(), "bake-packages-"));
    const file = join(dir, "a.ts");
    writeFileSync(
      file,
      [
        'import { WebGPURenderer } from "three/webgpu";',
        'import { Document } from "@gltf-transform/core";',
        'import { readFileSync } from "node:fs";',
        'import { join } from "path";',
        'import type { Feature } from "geojson";',
        'import { b } from "./b";',
        'import { c } from "@/c";',
        "export const used = [WebGPURenderer, Document, readFileSync, join, b, c];",
        "export type Used = Feature;",
      ].join("\n")
    );
    expect(packageImports(file)).toEqual(["@gltf-transform/core", "three"]);
  });
});

describe("lockedVersions", () => {
  const lockfile = (b: string, viewer: string) =>
    readLockfile(`{
      "lockfileVersion": 1,
      "packages": {
        "a": ["a@1.0.0", "", { "dependencies": { "b": "^1", "c": "^2" }, "optionalDependencies": { "gone": "1" }, "peerDependencies": { "@types/node": "*" } }, "sha512-a"],
        "b": ["b@${b}", "", {}, "sha512-b"],
        "c": ["c@1.0.0", "", {}, "sha512-c1"],
        "a/c": ["c@2.0.0", "", {}, "sha512-c2"],
        "@types/node": ["@types/node@26.0.0", "", {}, "sha512-t"],
        "viewer": ["viewer@${viewer}", "", {}, "sha512-v"],
      },
    }`);
  const keys = (lines: string[]) => lines.map((line) => line.split(" ")[0]);

  test("holds a package and what it depends on, the copy nested under it first", () => {
    expect(keys(lockedVersions(lockfile("1.0.0", "3.0.0"), ["a"]))).toEqual([
      "a",
      "a/c",
      "b",
    ]);
  });

  test("changes with a dependency's version, not an unrelated package's", () => {
    const first = lockedVersions(lockfile("1.0.0", "3.0.0"), ["a"]);
    expect(lockedVersions(lockfile("1.0.0", "4.0.0"), ["a"])).toEqual(first);
    expect(lockedVersions(lockfile("1.1.0", "3.0.0"), ["a"])).not.toEqual(
      first
    );
  });

  test("fails for a package or a dependency the lockfile lacks", () => {
    const lock = lockfile("1.0.0", "3.0.0");
    expect(() => lockedVersions(lock, ["missing"])).toThrow(
      "not in the lockfile"
    );
    const { b: _, ...withoutB } = lock;
    expect(() => lockedVersions(withoutB, ["a"])).toThrow(
      '"b", a dependency of "a"'
    );
  });

  test("the bake's packages are in the repo's lockfile, down to their dependencies; the viewer's are not", () => {
    const lock = readLockfile(readFileSync("bun.lock", "utf8"));
    const packages = moduleGraph("scripts/prepare-data.ts").flatMap(
      packageImports
    );
    const locked = keys(lockedVersions(lock, packages));
    for (const name of [
      "three",
      "@gltf-transform/core",
      "@gltf-transform/extensions",
      "@gltf-transform/functions",
      "meshoptimizer",
      "cityjson-threejs-loader",
      "geotiff",
      // geotiff's own
      "pako",
      "delatin",
      "delaunator",
      "sharp",
    ]) {
      expect(locked).toContain(name);
    }
    for (const name of ["next", "react", "3d-tiles-renderer", "@types/node"]) {
      expect(locked).not.toContain(name);
    }
  });
});
