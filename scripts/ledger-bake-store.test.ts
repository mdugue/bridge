import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { measureBakeStore } from "./ledger-bake-store";

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
  return root;
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
    ownsModules: 2,
  });
});

test("a tree without bakes or baked files has a section all the same", () => {
  const root = mkdtempSync(nodePath.join(tmpdir(), "ledger-bake-store-"));
  expect(measureBakeStore(root)).toEqual({
    sites: [],
    fileKinds: { total: 0, formats: 0, byFormat: {} },
    mixedKeyOrder: [],
    stepCacheCodeLines: 0,
    neighboursModules: 0,
    ownsModules: 0,
  });
});

test("a second reading is the same section", () => {
  const root = tree();
  expect(JSON.stringify(measureBakeStore(root))).toBe(
    JSON.stringify(measureBakeStore(root))
  );
});
