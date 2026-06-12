import { expect, test } from "bun:test";
import { recenterOffset } from "./recenter";

test("recenterOffset extracts the negated translation from a column-major matrix", () => {
  // Identity with translation (-413_000, -5_657_000, 0) — what the CityJSON
  // loader produces for a tile centered at (413000, 5657000).
  const elements = [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -413_000, -5_657_000, 0, 1,
  ];
  expect(recenterOffset({ elements })).toEqual({
    cx: 413_000,
    cy: 5_657_000,
  });
});

test("recenterOffset of the identity matrix is zero", () => {
  const elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  expect(recenterOffset({ elements })).toEqual({ cx: -0, cy: -0 });
});
