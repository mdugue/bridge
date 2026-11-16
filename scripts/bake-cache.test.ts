import { expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { cachedEntry, generations, writeEntry } from "./bake-cache";

const bytes = (text: string) => new TextEncoder().encode(text);

test("one whole entry per name unless more are kept; other names and other processes' parts stay", () => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "bake-cache-"));
  writeEntry(dir, "terrain_a_l0.glb.gz", "old", bytes("stale"));
  writeEntry(dir, "terrain_b_l0.glb.gz", "kb", bytes("b"));
  // another process, mid-write of the same name under the new key
  writeFileSync(
    nodePath.join(dir, "new.terrain_a_l0.glb.gz.999999.part"),
    "half"
  );
  writeEntry(dir, "terrain_a_l0.glb.gz", "new", bytes("fresh"));
  // ...and a second process writing the same entry again
  writeEntry(dir, "terrain_a_l0.glb.gz", "new", bytes("fresh"));
  expect(readdirSync(dir).toSorted()).toEqual([
    "kb.terrain_b_l0.glb.gz",
    "new.terrain_a_l0.glb.gz",
    "new.terrain_a_l0.glb.gz.999999.part",
  ]);
  const path = cachedEntry(dir, "terrain_a_l0.glb.gz", "new");
  expect(path && readFileSync(path, "utf-8")).toBe("fresh");
  expect(cachedEntry(dir, "terrain_a_l0.glb.gz", "old")).toBeNull();
});

test("a name keeps its newest generations, the one last read among them", () => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "bake-cache-"));
  const at = (key: string, ms: number) =>
    utimesSync(
      nodePath.join(dir, `${key}.city_a.json`),
      new Date(ms),
      new Date(ms)
    );
  writeEntry(dir, "city_a.json", "k1", bytes("1"), 3);
  at("k1", 1000);
  writeEntry(dir, "city_a.json", "k2", bytes("2"), 3);
  at("k2", 2000);
  writeEntry(dir, "city_a.json", "k3", bytes("3"), 3);
  at("k3", 3000);
  // a name that ends in this one's is another name
  writeEntry(dir, "x.city_a.json", "k0", bytes("x"), 3);
  // k1, the oldest, is read again (a checkout back to its branch)
  expect(cachedEntry(dir, "city_a.json", "k1")).not.toBeNull();
  writeEntry(dir, "city_a.json", "k4", bytes("4"), 3);
  expect(readdirSync(dir).toSorted()).toEqual([
    "k0.x.city_a.json",
    "k1.city_a.json",
    "k3.city_a.json",
    "k4.city_a.json",
  ]);
});

test("Vercel and CI keep one generation, a desk three, the variable any", () => {
  expect(generations({})).toBe(3);
  expect(generations({ VERCEL: "1" })).toBe(1);
  expect(generations({ CI: "true" })).toBe(1);
  expect(generations({ CI: "true", BAKE_CACHE_GENERATIONS: "2" })).toBe(2);
  expect(generations({ BAKE_CACHE_GENERATIONS: "0" })).toBe(3);
});
