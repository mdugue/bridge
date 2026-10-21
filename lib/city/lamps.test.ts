import { expect, test } from "bun:test";
import {
  ARM_REACH,
  armOffset,
  armReach,
  LAMP_POST_H,
  postHeight,
} from "./lamps";

const at = { type: "Point" as const, coordinates: [0, 0] as [number, number] };

test("a post stands at its measured height, else at the old 5 m", () => {
  expect(
    postHeight({ geometry: at, properties: { h: 9.5, hs: "street" } })
  ).toBe(9.5);
  expect(postHeight({ geometry: at, properties: {} })).toBe(LAMP_POST_H);
  expect(postHeight({ geometry: at, properties: null })).toBe(LAMP_POST_H);
  expect(postHeight({ geometry: at, properties: { h: 0 } })).toBe(LAMP_POST_H);
});

test("a mast's arm reaches a fifth of its height, within bounds, to its bearing", () => {
  expect(armReach(10)).toBeCloseTo(2);
  expect(armReach(4)).toBe(ARM_REACH.min);
  expect(armReach(14)).toBe(ARM_REACH.max);
  const east = armOffset({ geometry: at, properties: { h: 9, arm: 90 } });
  expect(east?.[0]).toBeCloseTo(1.8);
  expect(east?.[1]).toBeCloseTo(0);
  // north is a bearing too
  const north = armOffset({ geometry: at, properties: { h: 10, arm: 0 } });
  expect(north?.[0]).toBeCloseTo(0);
  expect(north?.[1]).toBeCloseTo(2);
  // a hung lamp or a wall lantern has none, nor a post without `arm`
  expect(
    armOffset({ geometry: at, properties: { h: 9, arm: 90, wall: [0, 1] } })
  ).toBeNull();
  expect(armOffset({ geometry: at, properties: { h: 9 } })).toBeNull();
});
