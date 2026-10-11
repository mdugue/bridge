import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedEntry, writeEntry } from "./bake-cache";

const bytes = (text: string) => new TextEncoder().encode(text);

test("one whole entry per name; other names and other processes' parts stay", () => {
  const dir = mkdtempSync(join(tmpdir(), "bake-cache-"));
  writeEntry(dir, "terrain_a_l0.glb.gz", "old", bytes("stale"));
  writeEntry(dir, "terrain_b_l0.glb.gz", "kb", bytes("b"));
  // another process, mid-write of the same name under the new key
  writeFileSync(join(dir, "new.terrain_a_l0.glb.gz.999999.part"), "half");
  writeEntry(dir, "terrain_a_l0.glb.gz", "new", bytes("fresh"));
  // ...and a second process writing the same entry again
  writeEntry(dir, "terrain_a_l0.glb.gz", "new", bytes("fresh"));
  expect(readdirSync(dir).toSorted()).toEqual([
    "kb.terrain_b_l0.glb.gz",
    "new.terrain_a_l0.glb.gz",
    "new.terrain_a_l0.glb.gz.999999.part",
  ]);
  const path = cachedEntry(dir, "terrain_a_l0.glb.gz", "new");
  expect(path && readFileSync(path, "utf8")).toBe("fresh");
  expect(cachedEntry(dir, "terrain_a_l0.glb.gz", "old")).toBeNull();
});
