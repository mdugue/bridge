import { expect, test } from "bun:test";
import { decodeDrawn, encodeDrawn } from "./drawn-facts";

test("a building's decisions survive the column", () => {
  const drawn = {
    wall: "osm",
    colour: "#c8b89a",
    material: "glass",
    roof: "dop",
    storey: "photos",
    windows: "near",
    wikidata: "Q2516",
  } as const;
  expect(decodeDrawn(encodeDrawn(drawn))).toEqual(drawn);
});

test("nothing known is the empty text, and back", () => {
  expect(encodeDrawn(undefined)).toBe("");
  expect(encodeDrawn({})).toBe("");
  expect(decodeDrawn("")).toEqual({});
});

test("a key a later bake added is dropped, the rest read", () => {
  expect(decodeDrawn("roof=osm;glaze=matt;storey=osm")).toEqual({
    roof: "osm",
    storey: "osm",
  });
});
