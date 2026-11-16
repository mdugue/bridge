import { expect, test } from "bun:test";
import {
  bakeStoreLedger,
  callingModules,
  handedOverKinds,
  KeyOrders,
  NEIGHBOURS_CALL,
  stepCacheLines,
} from "./ledger-bake-store";

const py = (name: string, text: string) => ({
  path: `pipeline/bake/${name}`,
  text,
});

test("a kind is a name and a format, whatever the tile", () => {
  expect(
    handedOverKinds([
      "lamps_33412_5656_2_sn.geojson",
      "lamps_33414_5656_2_sn.geojson",
      "landcover_33412_5656_2_sn.png",
      "landcover_33412_5656_2_sn.json",
      "markings_low_33412_5656_2_sn.png",
      "markings_33412_5656_2_sn.png",
      "roofcolor_566_5932_1_hh.json",
    ])
  ).toEqual({
    total: 6,
    formats: 3,
    byFormat: { geojson: 1, json: 2, png: 3 },
  });
});

test("a file not named for a tile is no kind a tile hands over", () => {
  expect(handedOverKinds(["landmark-facts.json", "murals.json"])).toEqual({
    total: 0,
    formats: 0,
    byFormat: {},
  });
});

test("the formats are listed in one order, whatever the names' order", () => {
  const names = ["b_1_2_3_sn.png", "a_1_2_3_sn.json", "c_1_2_3_sn.geojson"];
  expect(Object.keys(handedOverKinds(names).byFormat)).toEqual(
    Object.keys(handedOverKinds(names.toReversed()).byFormat)
  );
});

test("a module that asks for the site's tiles is counted once", () => {
  const files = [
    py("walls.py", "a = tile.neighbours()\nb = tile.neighbours ()\n"),
    py("providers/sn.py", "for tid, b in tile.neighbours():\n    pass\n"),
    py("common.py", "def neighbours(self):\n    return []\n"),
    py("notes.py", "# tile.neighbours() is every tile\n"),
  ];
  expect(callingModules(files, NEIGHBOURS_CALL)).toBe(2);
});

test("the step cache's lines are its code: no comment, no blank line", () => {
  const files = [
    py(
      "step_cache.py",
      "# a comment\n\nVERSION = 3\n\n\ndef key():\n    return 1  # why\n"
    ),
    py("other.py", "x = 1\ny = 2\nz = 3\nw = 4\n"),
  ];
  expect(stepCacheLines(files)).toBe(3);
  expect(stepCacheLines(files.slice(1))).toBe(0);
});

test("a kind that each site writes in one order, but not the same, is mixed", () => {
  const orders = new KeyOrders();
  // Dresden's traffic, then the other sites'
  orders.add("traffic", ["t", "f", "hf", "b"]);
  expect(orders.mixed()).toEqual([]);
  orders.add("traffic", ["t", "f", "b", "sp", "hf"]);
  expect(orders.mixed()).toEqual(["traffic"]);
});

test("a kind whose rows turn two keys round has no single key order", () => {
  const orders = new KeyOrders();
  orders.add("lamps", ["h", "hs", "wire"]);
  orders.add("lamps", ["h", "wire"]);
  orders.add("lamps", ["hs"]);
  orders.add("lamps", ["wire", "deck"]);
  orders.add("traffic", ["t", "f", "b"]);
  orders.add("traffic", ["t", "b", "f"]);
  orders.add("empty", []);
  expect(orders.mixed()).toEqual(["traffic"]);
});

test("three rows that write their keys in a circle have no single order", () => {
  const orders = new KeyOrders();
  orders.add("furniture", ["k", "a"]);
  orders.add("furniture", ["a", "c"]);
  expect(orders.mixed()).toEqual([]);
  orders.add("furniture", ["c", "k"]);
  expect(orders.mixed()).toEqual(["furniture"]);
});

test("the section holds each figure under its own name", () => {
  const orders = new KeyOrders();
  orders.add("traffic", ["t", "f"]);
  orders.add("traffic", ["f", "t"]);
  expect(
    bakeStoreLedger(
      ["meissen", "dresden"],
      [
        py("common.py", "def owns(b, x, y):\n    return True\n"),
        py("walls.py", "tile.neighbours()\nowns(b, 1, 2)\n"),
        py("step_cache.py", "VERSION = 3\n"),
      ],
      ["lamps_1_2_2_sn.geojson", "ndvi_1_2_2_sn.png"],
      orders
    )
  ).toEqual({
    sites: ["dresden", "meissen"],
    fileKinds: { total: 2, formats: 2, byFormat: { geojson: 1, png: 1 } },
    mixedKeyOrder: ["traffic"],
    stepCacheCodeLines: 1,
    neighboursModules: 1,
  });
});
