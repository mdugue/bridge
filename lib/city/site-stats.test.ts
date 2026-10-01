import { expect, test } from "bun:test";
import {
  buildingHeights,
  footprintArea,
  landcoverShares,
  orderSites,
  parseSiteStats,
  quantile,
  type SiteStats,
} from "./site-stats";
import type { CityJsonDocument } from "./types";

const stats = (over: Partial<SiteStats>): SiteStats => ({
  areaKm2: 16,
  buildingsPerKm2: 500,
  builtShare: 0.3,
  crownsPerKm2: 800,
  greenShare: 0.2,
  landmarks: 10,
  medianHeightM: 12,
  reliefM: 20,
  tallestM: 80,
  waterShare: 0.05,
  ...over,
});

const cities = [
  { id: "unna", name: "Unna", stats: stats({ crownsPerKm2: 1500 }) },
  { id: "hamburg", name: "Hamburg", stats: stats({ waterShare: 0.2 }) },
  { id: "dresden", name: "Dresden", stats: stats({ crownsPerKm2: 900 }) },
  { id: "berlin", name: "Berlin" },
];

test("the featured order puts the reference site first, then by name", () => {
  expect(orderSites(cities, "featured", "dresden").map((c) => c.id)).toEqual([
    "dresden",
    "berlin",
    "hamburg",
    "unna",
  ]);
});

test("an ordering ranks by its figure, a city without figures last", () => {
  expect(orderSites(cities, "crowns", "dresden").map((c) => c.id)).toEqual([
    "unna",
    "dresden",
    "hamburg",
    "berlin",
  ]);
  expect(orderSites(cities, "water", "dresden")[0].id).toBe("hamburg");
});

test("the land cover's green and water shares", () => {
  // background, farmland, forest, copse, builtup, rail, path, road, water
  const shares = landcoverShares([10, 10, 20, 10, 30, 0, 5, 5, 10]);
  expect(shares.greenShare).toBeCloseTo(0.4, 5);
  expect(shares.waterShare).toBeCloseTo(0.1, 5);
  expect(landcoverShares([])).toEqual({ greenShare: 0, waterShare: 0 });
});

test("a building's height: measured, else the span of it and its parts", () => {
  const doc: CityJsonDocument = {
    type: "CityJSON",
    version: "2.0",
    transform: { scale: [1, 1, 0.01], translate: [0, 0, 0] },
    vertices: [
      [0, 0, 10_000],
      [0, 0, 12_500],
      [0, 0, 11_000],
    ],
    CityObjects: {
      a: { type: "Building", attributes: { measuredHeight: 18.5 } },
      b: { type: "Building", children: ["b1"] },
      b1: {
        type: "BuildingPart",
        parents: ["b"],
        geometry: [{ boundaries: [[[0, 1, 2]]] }],
      },
    },
  };
  expect(buildingHeights(doc).sort((a, b) => a - b)).toEqual([18.5, 25]);
  expect(quantile([3, 1, 2], 0.5)).toBe(2);
  expect(quantile([], 0.5)).toBe(0);
});

test("footprints in centimetres add up to square metres", () => {
  const square: [number, number][] = [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ];
  expect(footprintArea([[square], [square]])).toBe(200);
});

test("only a complete record parses as stats", () => {
  expect(parseSiteStats(stats({}))).toBeDefined();
  expect(parseSiteStats({ areaKm2: 4 })).toBeUndefined();
});
