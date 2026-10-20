import { expect, test } from "bun:test";
import { LAMP_POST_H, postHeight } from "./lamps";

const at = { type: "Point" as const, coordinates: [0, 0] as [number, number] };

test("a post stands at its measured height, else at the old 5 m", () => {
  expect(
    postHeight({ geometry: at, properties: { h: 9.5, hs: "street" } })
  ).toBe(9.5);
  expect(postHeight({ geometry: at, properties: {} })).toBe(LAMP_POST_H);
  expect(postHeight({ geometry: at, properties: null })).toBe(LAMP_POST_H);
  expect(postHeight({ geometry: at, properties: { h: 0 } })).toBe(LAMP_POST_H);
});
