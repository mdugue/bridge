import { expect, test } from "bun:test";
import {
  CELL_M,
  isoWeek,
  type PanoramaxItem,
  pickPhotos,
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

test("one photo per cell, the newest, in an order the seed fixes", () => {
  const items = [
    item("old", 10, 10, "2024-01-01"),
    item("new", 20, 20, "2025-01-01"),
    item("far", CELL_M * 3, 10, "2023-05-01"),
  ];
  const picked = pickPhotos(items, 5, "2026-W44");
  expect(picked.map((p) => p.id).sort()).toEqual(["far", "new"]);
  expect(pickPhotos(items, 5, "2026-W44")).toEqual(picked);
  expect(shuffled([1, 2, 3, 4, 5], "x")).toEqual(
    shuffled([1, 2, 3, 4, 5], "x")
  );
});

test("the ISO week", () => {
  expect(isoWeek(new Date("2026-10-30T12:00:00Z"))).toBe("2026-W44");
  expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
});
