import { expect, test } from "bun:test";
import { landmarkVantage, siteLandmarks } from "./landmarks";

const entry = (id: string, links: number, h?: number, height?: number) => ({
  id,
  links,
  name: id,
  objects: ["o"],
  x: 1000,
  y: 2000,
  ...(h === undefined ? {} : { h }),
  ...(height === undefined ? {} : { height }),
});

test("the site's landmarks: one per item, most notable first, the taller height", () => {
  const list = siteLandmarks([
    { landmarks: [entry("Q1", 5, 20), entry("Q2", 40, 96, 110)] },
    { landmarks: [entry("Q2", 40, 50), entry("Q3", 5)] },
  ]);
  expect(list.map((l) => l.id)).toEqual(["Q2", "Q1", "Q3"]);
  expect(list[0].h).toBe(110);
  // no height known: framed as a mid-rise
  expect(list[2].h).toBe(25);
  expect(
    siteLandmarks([{ landmarks: [entry("A", 1), entry("B", 2)] }], 1)
  ).toHaveLength(1);
});

test("a vantage looks at the landmark from the south-south-west, higher for a taller one", () => {
  const low = landmarkVantage({
    h: 15,
    id: "a",
    links: 1,
    name: "a",
    x: 0,
    y: 0,
  });
  const high = landmarkVantage({
    h: 110,
    id: "b",
    links: 1,
    name: "b",
    x: 0,
    y: 0,
  });
  expect(low.mode).toBe("fly");
  expect(low.pitchDeg).toBeLessThan(0);
  expect(low.epsg.x).toBeLessThan(0);
  expect(low.epsg.y).toBeLessThan(0);
  expect(low.headingDeg).toBe(25);
  expect(high.aboveGround).toBeGreaterThan(low.aboveGround);
  expect(Math.hypot(high.epsg.x, high.epsg.y)).toBeGreaterThan(
    Math.hypot(low.epsg.x, low.epsg.y)
  );
});
