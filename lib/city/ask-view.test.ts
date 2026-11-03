import { expect, test } from "bun:test";
import { askView } from "./ask-view";

test("on foot the walker stands in front, on the side they come from, looking at it", () => {
  const v = askView({ x: 1000, y: 2000, h: 20 }, { x: 1000, y: 1500 }, false);
  expect(v.mode).toBe("walk");
  expect(v.aboveGround).toBe(1.6);
  // south of it, 43 m back, looking north and up
  expect(v.epsg.x).toBe(1000);
  expect(v.epsg.y).toBeCloseTo(2000 - 43, 5);
  expect(v.headingDeg).toBe(0);
  expect(v.pitchDeg).toBeGreaterThan(0);
});

test("from the air the camera hangs off it, looking down", () => {
  const v = askView({ x: 0, y: 0, h: 90 }, { x: 500, y: 0 }, true);
  expect(v.mode).toBe("fly");
  expect(v.aboveGround).toBeGreaterThanOrEqual(90);
  expect(v.epsg.x).toBeGreaterThan(0);
  expect(v.headingDeg).toBe(270);
  expect(v.pitchDeg).toBeLessThan(-10);
});

test("standing on the target, it is approached from the south", () => {
  const v = askView({ x: 5, y: 5 }, { x: 5, y: 5 }, false);
  expect(v.epsg.y).toBeLessThan(5);
  expect(v.headingDeg).toBe(0);
});
