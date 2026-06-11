import { expect, test } from "bun:test";
import { filterCityObject } from "./filter-city-object";
import type { CityJsonDocument } from "./types";

function doc(): CityJsonDocument {
  return {
    type: "CityJSON",
    version: "2.0",
    CityObjects: {
      solo: { type: "Building", geometry: [] },
      parent: { type: "Building", children: ["partA", "partB"] },
      partA: { type: "BuildingPart", parents: ["parent"], geometry: [] },
      partB: { type: "BuildingPart", parents: ["parent"], geometry: [] },
      bystander: { type: "Building", geometry: [] },
    },
    vertices: [[0, 0, 0]],
  };
}

test("removes a standalone building and nothing else", () => {
  const result = filterCityObject(doc(), "solo");
  expect(Object.keys(result.CityObjects).sort()).toEqual([
    "bystander",
    "parent",
    "partA",
    "partB",
  ]);
});

test("removing a BuildingPart removes the parent and sibling parts too", () => {
  const result = filterCityObject(doc(), "partA");
  expect(Object.keys(result.CityObjects).sort()).toEqual(["bystander", "solo"]);
});

test("removing a parent removes all of its parts", () => {
  const result = filterCityObject(doc(), "parent");
  expect(Object.keys(result.CityObjects).sort()).toEqual(["bystander", "solo"]);
});

test("does not mutate the input document", () => {
  const input = doc();
  filterCityObject(input, "parent");
  expect(Object.keys(input.CityObjects)).toHaveLength(5);
});

test("unknown ids are a no-op returning the same document", () => {
  const input = doc();
  expect(filterCityObject(input, "nope")).toBe(input);
});

test("shares vertices by reference (no deep copy)", () => {
  const input = doc();
  const result = filterCityObject(input, "solo");
  expect(result.vertices).toBe(input.vertices);
});
