import { expect, test } from "bun:test";
import type { AskSolid } from "@/lib/city/ask-solids";
import { solidShape } from "./selection-shape";

const post: AskSolid = { cylinder: { r: 0.1, x: 0, y0: 0, y1: 5, z: 0 } };
const head: AskSolid = { cylinder: { r: 0.3, x: 1, y0: 4.6, y1: 5, z: 0 } };

test("a thing with two cylinders that is no tree keeps both as cylinders", () => {
  // an arm lamp (post and head) or a hedge 2-4 m long has exactly two
  const twice = solidShape([post, head]);
  expect(twice.length).toBe(
    solidShape([post]).length + solidShape([head]).length
  );
});

test("a tree's second solid is its crown, drawn as the crown form says", () => {
  const cylinders = solidShape([post, head]).length;
  expect(solidShape([post, head], "ellipsoid").length).not.toBe(cylinders);
  expect(solidShape([post, head], "cone").length).not.toBe(cylinders);
  // the first solid, the trunk, stays a cylinder whatever the crown
  const trunkOnly = solidShape([post], "ellipsoid");
  expect(trunkOnly.length).toBe(solidShape([post]).length);
});
