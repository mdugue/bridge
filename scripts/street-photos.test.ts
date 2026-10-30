import { expect, test } from "bun:test";
import {
  CELL_M,
  cellsInOrder,
  isoWeek,
  lonLatBox,
  newestIn,
  type PanoramaxItem,
  shuffled,
  usable,
  verticalFov,
} from "./street-photos";

const item = (
  id: string,
  x: number,
  y: number,
  datetime: string,
  extra: Partial<PanoramaxItem["properties"]> = {}
) => ({
  id,
  x,
  y,
  geometry: { coordinates: [13.7, 51] as [number, number] },
  properties: { datetime, "view:azimuth": 90, ...extra },
  assets: { sd: { href: `https://example.org/${id}.jpg` } },
});

test("a 360° picture, one without heading or one badly placed is no use", () => {
  expect(usable(item("a", 0, 0, "2025"))).toBe(true);
  expect(
    usable(
      item("b", 0, 0, "2025", {
        "pers:interior_orientation": { field_of_view: 360 },
      })
    )
  ).toBe(false);
  expect(usable(item("c", 0, 0, "2025", { "view:azimuth": undefined }))).toBe(
    false
  );
  expect(
    usable(item("d", 0, 0, "2025", { "quality:horizontal_accuracy": 20 }))
  ).toBe(false);
});

test("the photo's width fits the 16:10 shot", () => {
  expect(verticalFov(65)).toBeCloseTo(43.4, 1);
  expect(verticalFov(90, 1)).toBeCloseTo(90, 5);
});

test("the newest usable photo inside a cell, the cells in an order the seed fixes", () => {
  const cell = [0, 0, CELL_M, CELL_M] as [number, number, number, number];
  const items = [
    item("old", 10, 10, "2024-01-01"),
    item("new", 20, 20, "2025-01-01"),
    item("outside", CELL_M + 5, 10, "2026-05-01"),
    item("round", 30, 30, "2026-06-01", {
      "pers:interior_orientation": { field_of_view: 360 },
    }),
  ];
  expect(newestIn(items, cell)?.id).toBe("new");
  const cells = cellsInOrder([0, 0, CELL_M * 3, CELL_M * 2], "2026-W44");
  expect(cells).toHaveLength(6);
  expect(cellsInOrder([0, 0, CELL_M * 3, CELL_M * 2], "2026-W44")).toEqual(
    cells
  );
  expect(shuffled([1, 2, 3, 4, 5], "x")).toEqual(
    shuffled([1, 2, 3, 4, 5], "x")
  );
});

test("a cell's lat/lon box holds all four of its corners", () => {
  const box = lonLatBox(25_833, [408_000, 5_654_000, 418_000, 5_660_000])!;
  // the grid is turned against the meridians: the west edge's north end
  // lies further west than its south end
  expect(box[0]).toBeLessThan(13.688);
  expect(box[2]).toBeGreaterThan(13.83);
});

test("the ISO week", () => {
  expect(isoWeek(new Date("2026-10-30T12:00:00Z"))).toBe("2026-W44");
  expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
});
