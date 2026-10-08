import { expect, test } from "bun:test";
import { landmarkVantage, siteLandmarks } from "./landmarks";

const entry = (id: string, links: number, h?: number, height?: number) => ({
  id,
  links,
  name: id,
  objects: [`lod2-${id}`],
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

test("a landmark housed in a more notable one's building is that one", () => {
  const housed = (id: string, links: number, objects: string[]) => ({
    ...entry(id, links),
    objects,
  });
  const list = siteLandmarks([
    {
      landmarks: [
        housed("Rüstkammer", 10, ["schloss", "flügel"]),
        housed("Residenzschloss", 32, ["schloss"]),
        housed("Hofkirche", 35, ["kirche"]),
      ],
    },
  ]);
  expect(list.map((l) => l.id)).toEqual(["Hofkirche", "Residenzschloss"]);
  // …and still found by its own name
  expect(list[1].also).toEqual(["Rüstkammer"]);
  expect(list[0].also).toBeUndefined();
  // the limit counts the buildings kept, not the items read
  expect(
    siteLandmarks(
      [
        {
          landmarks: [
            housed("A", 9, ["a"]),
            housed("A2", 8, ["a"]),
            housed("B", 7, ["b"]),
            housed("C", 6, ["c"]),
            housed("B2", 5, ["b"]),
          ],
        },
      ],
      2
    ).map((l) => [l.id, l.also])
  ).toEqual([
    ["A", ["A2"]],
    // housed in a kept one, though less notable than the first one cut
    ["B", ["B2"]],
  ]);
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

test("landmarks tied on links keep the id order, whatever the locale", () => {
  const named = (id: string, name: string) => ({ ...entry(id, 2), name });
  const list = siteLandmarks([
    {
      landmarks: [
        named("Q2", "Äußere Neustadt"),
        named("Q1", "Zwinger"),
        named("Q3", "Frauenkirche"),
      ],
    },
  ]);
  expect(list.map((l) => l.id)).toEqual(["Q1", "Q2", "Q3"]);
});
