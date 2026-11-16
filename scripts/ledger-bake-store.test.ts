import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { gitEnv } from "./git-tracked";
import { measureBakeStore, trackedBaked } from "./ledger-bake-store";

const write = (root: string, path: string, text: string) => {
  const file = nodePath.join(root, path);
  mkdirSync(nodePath.dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const features = (...rows: Record<string, unknown>[]) =>
  JSON.stringify({
    type: "FeatureCollection",
    features: rows.map((properties) => ({
      type: "Feature",
      properties,
      geometry: null,
    })),
  });

function tree(): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), "ledger-bake-store-"));
  write(
    root,
    "pipeline/bake/common.py",
    "def owns(b, x, y):\n    return True\n"
  );
  write(root, "pipeline/bake/walls.py", "t.neighbours()\nowns(b, 1, 2)\n");
  write(root, "pipeline/bake/providers/sn.py", "x = crowns(1)\n");
  write(root, "pipeline/bake/step_cache.py", "# why\nVERSION = 3\n\nX = 1\n");
  write(root, "pipeline/tests/test_walls.py", "owns(b, 1, 2)\n");
  const a = "data/alpha/dlm";
  write(root, `${a}/lamps_1_2_2_sn.geojson`, features({ h: 1, hs: "dom" }));
  write(root, `${a}/traffic_1_2_2_sn.geojson`, features({ t: 1, f: 2 }));
  write(root, `${a}/ndvi_1_2_2_sn.png`, "");
  write(root, "data/alpha/dop/roofcolor_1_2_2_sn.json", "{}");
  write(root, "data/alpha/landmark-facts.json", "{}");
  write(root, "data/alpha/cityjson/lod2_1_2_2_sn.city.json", "{}");
  const b = "data/beta/dlm";
  write(root, `${b}/lamps_3_4_2_sn.geojson`, features({ hs: "osm" }));
  write(root, `${b}/traffic_3_4_2_sn.geojson`, features({ f: 2, t: 1 }));
  write(root, `${b}/sport_3_4_2_sn.json`, "{}");
  // the raw downloads are no site, whatever lies in them
  write(root, "data/_raw/sn/osm/lamps_9_9_2_sn.geojson", features({ z: 1 }));
  commit(root);
  return root;
}

/** Makes `root` a work tree that tracks everything in it so far. */
function commit(root: string): void {
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
  ]) {
    const done = Bun.spawnSync(["git", ...args], { cwd: root, env: gitEnv() });
    expect(done.exitCode).toBe(0);
  }
}

test("the section is read from the bake modules and every site's baked files", () => {
  expect(measureBakeStore(tree())).toEqual({
    sites: ["alpha", "beta"],
    fileKinds: {
      total: 5,
      formats: 3,
      byFormat: { geojson: 2, json: 2, png: 1 },
    },
    mixedKeyOrder: ["traffic"],
    stepCacheCodeLines: 2,
    neighboursModules: 1,
  });
});

test("what git does not track is no figure: a site not committed, a leftover", () => {
  const root = tree();
  const before = measureBakeStore(root);
  // a site fetched and baked here but never committed, a file an
  // interrupted bake left behind, a kind nobody has committed
  write(
    root,
    "data/gamma/dlm/lamps_5_6_2_sn.geojson",
    features({ z: 1, h: 2 })
  );
  write(root, "data/gamma/dlm/traffic_5_6_2_sn.geojson", features({ b: 1 }));
  write(root, "data/alpha/dlm/lamps_1_2_2_sn.geojson.tmp", "half a file");
  write(root, "data/alpha/dlm/novel_1_2_2_sn.bin", "");
  expect(measureBakeStore(root)).toEqual(before);
  expect(trackedBaked(root).map((file) => file.site)).not.toContain("gamma");
  // a tracked file is read as it lies in the work tree
  write(
    root,
    "data/beta/dlm/lamps_3_4_2_sn.geojson",
    features({ hs: 1, h: 2 })
  );
  expect(measureBakeStore(root).mixedKeyOrder).toEqual(["lamps", "traffic"]);
});

test("only a tile's files under dlm/ and dop/ are baked files", () => {
  expect(trackedBaked(tree()).map((file) => file.path)).toEqual([
    "data/alpha/dlm/lamps_1_2_2_sn.geojson",
    "data/alpha/dlm/ndvi_1_2_2_sn.png",
    "data/alpha/dlm/traffic_1_2_2_sn.geojson",
    "data/alpha/dop/roofcolor_1_2_2_sn.json",
    "data/beta/dlm/lamps_3_4_2_sn.geojson",
    "data/beta/dlm/sport_3_4_2_sn.json",
    "data/beta/dlm/traffic_3_4_2_sn.geojson",
  ]);
});

test("a tree without bakes or baked files has a section all the same", () => {
  const root = mkdtempSync(nodePath.join(tmpdir(), "ledger-bake-store-"));
  expect(measureBakeStore(root)).toEqual({
    sites: [],
    fileKinds: { total: 0, formats: 0, byFormat: {} },
    mixedKeyOrder: [],
    stepCacheCodeLines: 0,
    neighboursModules: 0,
  });
});

test("a second reading is the same section", () => {
  const root = tree();
  expect(JSON.stringify(measureBakeStore(root))).toBe(
    JSON.stringify(measureBakeStore(root))
  );
});
