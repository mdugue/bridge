import { expect, test } from "bun:test";
import {
  carryOf,
  coverFigures,
  cpuDecodes,
  levelBySort,
  shapeOf,
  sortBytes,
  variantCounts,
  variantKey,
  artifactFigures,
} from "./ledger-rasters";
import type { LevelHold, TileHold } from "./ledger-rasters";

test("a sparse raster carries by its kind's own empty value", () => {
  // two RGBA texels: the first empty, the second with one byte set
  const rgba = new Uint8Array([0, 0, 0, 0, 0, 0, 7, 0]);
  expect(carryOf("sport", rgba, 2, 4)).toEqual({
    texels: 1,
    box: [1, 0, 1, 0],
  });
  // markings: B = 128 is the neutral offset, not a mark
  const marks = new Uint8Array([0, 0, 128, 0, 0, 0, 129, 0]);
  expect(carryOf("markings", marks, 2, 4).texels).toBe(1);
  // colonies: only R counts (G is an axis code)
  const rg = new Uint8Array([0, 9, 0, 0, 3, 0, 0, 0]);
  expect(carryOf("colonies", rg, 2, 2)).toEqual({
    texels: 1,
    box: [0, 1, 0, 1],
  });
  expect(carryOf("surface", new Uint8Array(16), 2, 4)).toEqual({
    texels: 0,
    box: null,
  });
});

test("a variant key names the optional rasters in splatVariant's order", () => {
  expect(variantKey(new Set(["svf", "ndvi"]), [2000, 2000])).toBe(
    "ndvi||||||svf||2000|2000"
  );
});

const hold = (
  bytes: Partial<Record<string, number>>,
  splat = 0
): LevelHold => ({
  rasters: Object.entries(bytes).map(([kind, b]) => ({
    // reason: the test's kinds are the table's
    kind: kind as LevelHold["rasters"][number]["kind"],
    bytes: b ?? 0,
  })),
  splat,
  variant: Object.keys(bytes).join("|"),
});

test("a level's bytes go by sort, the splat apart", () => {
  const level = hold({ class: 4, edges: 2, svf: 1, horizon: 1 }, 2);
  expect(sortBytes(level)).toEqual({
    exact: 4,
    measured: 2,
    soft: 2,
    splat: 2,
    total: 10,
    softShare: 0.2,
  });
});

const tile = (id: string, fine: LevelHold, phoneFine = fine): TileHold => ({
  tile: id,
  levels: {
    desktop: { fine, fineFar: fine, coarse: hold({ class: 1 }) },
    phone: { fine: phoneFine, fineFar: phoneFine, coarse: hold({ class: 1 }) },
  },
});

test("the fine level's spawn and largest tile, and the distinct programs", () => {
  const holds = [
    tile("b", hold({ class: 4 })),
    tile("a", hold({ class: 4, sport: 4 }), hold({ class: 2 })),
  ];
  const fine = levelBySort(holds, "fine");
  expect(fine.desktop.spawn.total).toBe(4);
  expect(fine.desktop.largest).toMatchObject({ tile: "a", total: 8 });
  expect(fine.phone.largest).toMatchObject({ tile: "b", total: 4 });
  const variants = variantCounts(holds);
  // the coarse levels' program is the fine "class" one's
  expect(variants.desktop).toBe(2);
  expect(variants.phone).toBe(1);
});

test("cover counts against the full raster, box and share", () => {
  const figures = coverFigures([
    { carry: { texels: 2, box: [0, 0, 1, 0] }, of: 16 },
    { carry: { texels: 0, box: null }, of: 16 },
  ]);
  expect(figures).toEqual({
    tiles: 2,
    share: { mean: 0.0625, max: 0.125 },
    box: { mean: 0.0625, max: 0.125 },
  });
});

test("artifacts sum their files once each, shapes sorted", () => {
  expect(
    artifactFigures([
      { artifact: "svf", wire: 3, shape: shapeOf(4, 4, 1) },
      { artifact: "svf", wire: 2, shape: shapeOf(4, 4, 1) },
      { artifact: "horizon", wire: 1, shape: shapeOf(2, 2, 4, 8) },
    ])
  ).toEqual({
    horizon: { files: 1, wire: 1, shapes: ["2×2×4×8"] },
    svf: { files: 2, wire: 5, shapes: ["4×4×1"] },
  });
});

test("a CPU decode not named fails the ledger", () => {
  const known = [{ module: "app/v.ts", kind: "ndvi" as const, use: "crowns" }];
  const sources = [
    { path: "app/up.ts", text: "decodeGreyPng(bytes)" },
    { path: "app/v.ts", text: "await decodeGreyPng(png)" },
  ];
  expect(cpuDecodes(sources, "app/up.ts", known)).toEqual(known);
  expect(() =>
    cpuDecodes(
      [...sources, { path: "app/w.ts", text: "decodeGreyPng(x)" }],
      "app/up.ts",
      known
    )
  ).toThrow("app/w.ts");
});
