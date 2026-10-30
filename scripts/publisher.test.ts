import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANIFEST_FILE } from "../lib/city/tile";
import { createPublisher, hashedName } from "./publisher";

const bytes = (s: string) => new TextEncoder().encode(s);
const fresh = () => mkdtempSync(join(tmpdir(), "publisher-"));

test("a name carries its content's hash and keeps a compound extension", () => {
  const a = hashedName("lamps_t.geojson", bytes("a"));
  expect(a).toMatch(/^lamps_t\.[0-9a-f]{8}\.geojson$/u);
  expect(hashedName("lamps_t.geojson", bytes("a"))).toBe(a);
  expect(hashedName("lamps_t.geojson", bytes("b"))).not.toBe(a);
  expect(hashedName("city_t.glb.gz", bytes("a"))).toMatch(/\.glb\.gz$/u);
  expect(hashedName("canopy_t.pts.gz", bytes("a"))).toMatch(/\.pts\.gz$/u);
});

test("the same bytes are written once; a run names its files in the manifest and prunes the rest", () => {
  const dir = fresh();
  writeFileSync(join(dir, "stale.1234abcd.json"), "old");
  const first = createPublisher(dir, { warming: false });
  const name = first.publish("a.json", bytes("one"));
  first.publishPlain("site-stats.json", bytes("{}"));
  expect(first.finish()).toEqual({ artifacts: 1, written: 1, pruned: 1 });
  expect(readdirSync(dir).toSorted()).toEqual(
    [MANIFEST_FILE, name, "site-stats.json"].toSorted()
  );
  const manifest: unknown = JSON.parse(
    readFileSync(join(dir, MANIFEST_FILE), "utf8")
  );
  expect(manifest).toEqual({ version: 1, files: { "a.json": name } });

  const second = createPublisher(dir, { warming: false });
  expect(second.publish("a.json", bytes("one"))).toBe(name);
  const changed = second.publish("b.json", bytes("two"));
  // the stats are not named this run: pruned like any file
  expect(second.finish()).toEqual({ artifacts: 2, written: 1, pruned: 1 });
  expect(existsSync(join(dir, changed))).toBe(true);
  expect(existsSync(join(dir, "site-stats.json"))).toBe(false);
});

test("a warmer names what it would publish and writes nothing", () => {
  const dir = join(fresh(), "site");
  const warmer = createPublisher(dir, { warming: true });
  const name = warmer.publish("a.json", bytes("one"));
  expect(name).toBe(hashedName("a.json", bytes("one")));
  warmer.publishPlain("site-stats.json", bytes("{}"));
  expect(warmer.finish()).toEqual({ artifacts: 1, written: 0, pruned: 0 });
  expect(existsSync(dir)).toBe(false);
});
