import { expect, test } from "bun:test";
import { parseSiteIndex, siteDataBase } from "./site-index";

test("the index parses, and drops what is not a site entry", () => {
  expect(
    parseSiteIndex({
      version: 1,
      sites: [{ id: "dresden", map: "/data/dresden/m.webp" }, { map: "x" }, 3],
    })
  ).toEqual({
    version: 1,
    sites: [{ id: "dresden", map: "/data/dresden/m.webp" }],
  });
});

test("an old or foreign file is no index", () => {
  expect(parseSiteIndex(null)).toBeNull();
  expect(parseSiteIndex({ version: 2, sites: [] })).toBeNull();
  expect(parseSiteIndex({ version: 1, files: {} })).toBeNull();
});

test("a site's data lives under its id", () => {
  expect(siteDataBase("unna")).toBe("/data/unna");
});
