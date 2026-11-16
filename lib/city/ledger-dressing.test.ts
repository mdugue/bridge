import { expect, test } from "bun:test";
import type { LedgerTile } from "./ledger";
import { dressingLedger, dressingLevel } from "./ledger-dressing";

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

test("the watched tiles, in the order asked, with the fine level's sports table", () => {
  const [only, ...rest] = dressingLedger(
    [tile("a"), tile("b")],
    [
      { tile: "b", what: "yards" },
      { tile: "missing", what: "nowhere" },
    ],
    wire
  );
  expect(rest).toEqual([]);
  expect(only).toEqual({
    tile: "b",
    what: "yards",
    fine: {
      bytes: 12 + 9 + 10,
      files: 3,
      kinds: { lamps: 9, sportTable: 10, tram: 12 },
    },
    coarse: { bytes: 8, files: 1, kinds: { crowns: 8 } },
  });
});
