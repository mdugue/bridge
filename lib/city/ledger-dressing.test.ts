import { expect, test } from "bun:test";
import { ledgerDiff } from "./ledger";
import type { LedgerTile } from "./ledger";
import { dressingLevel, dressingTiles } from "./ledger-dressing";

const wire = (file: string) => file.length;

const tile = (id: string): LedgerTile => ({
  id,
  city: "city",
  cityFar: "far",
  cityExtras: {},
  footprints: "f",
  ask: {},
  terrain: {
    0: {
      uri: "fine.glb.gz",
      extras: {
        dressing: { tram: "tram.geojson", lamps: "l.geojson", none: "" },
        sportTable: "sport.json",
        ndvi: "ndvi.png",
      },
    },
    1: { uri: "coarse.glb.gz", extras: { coarse: { crowns: "c.crw.gz" } } },
  },
});

test("a level's dressing is weighed kind by kind, a kind it lacks left out", () => {
  expect(dressingLevel({ b: "bb", a: "a", none: "", n: 3 }, wire)).toEqual({
    bytes: 3,
    files: 2,
    kinds: { a: 1, b: 2 },
  });
});

test("the watched tiles, each under what it is watched for, with the fine level's sports table", () => {
  const tiles = dressingTiles(
    [tile("a"), tile("b")],
    [
      { tile: "b", what: "yards" },
      { tile: "missing", what: "nowhere" },
    ],
    wire
  );
  expect(tiles).toEqual({
    yards: {
      tile: "b",
      what: "yards",
      fine: {
        bytes: 12 + 9 + 10,
        files: 3,
        kinds: { lamps: 9, sportTable: 10, tram: 12 },
      },
      coarse: { bytes: 8, files: 1, kinds: { crowns: 8 } },
    },
  });
});

test("every gated figure is a named leaf, and the recorded part is none", () => {
  const section = {
    tiles: dressingTiles([tile("b")], [{ tile: "b", what: "yards" }], wire),
    recorded: { note: "n", browser: { ms: 1 } },
  };
  const moved = structuredClone(section);
  moved.tiles.yards.fine.kinds.tram = 13;
  moved.recorded.browser.ms = 2;
  expect(ledgerDiff({ dressing: section }, { dressing: moved })).toEqual([
    "dressing.tiles.yards.fine.kinds.tram: 12 → 13",
  ]);
});
