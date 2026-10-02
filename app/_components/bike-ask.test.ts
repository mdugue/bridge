import { expect, test } from "bun:test";
import type { BikeCounter } from "@/lib/city/bike-counts";
import { bikeAskSets } from "./bike-ask";

const counter: BikeCounter = {
  angleDeg: 0,
  directions: [
    { count: 100, toward: "Neustadt" },
    { count: 25, toward: "Altstadt" },
  ],
  id: "7",
  measuredAt: new Date(2026, 9, 1, 14),
  name: "Albertbrücke",
  where: "",
  x: 0,
  y: 0,
};
const ground = { offset: { cx: 0, cy: 0 }, heightAt: () => 110 };

test("a counter is asked on its columns, as tall as their bicycles", () => {
  const sets = bikeAskSets([counter], ground, new Date(2026, 9, 1, 15));
  // the street runs north: the columns stand east and west of it, 1.1 m
  const east = sets[0]?.nearest(
    { x: 1.1, y: 300, z: 0 },
    { x: 0, y: -1, z: 0 },
    1000
  );
  expect(east?.target.kind).toBe("bikes");
  expect(east?.target.kind === "bikes" && east.target.name).toBe(
    "Albertbrücke"
  );
  // its top 1.5 + 1.6·√25 = 9.5 m over the ground
  expect(east?.distance).toBeCloseTo(300 - 119.5, 5);
  // between them, past their margin: the street, not the counter
  expect(
    sets[0]?.nearest({ x: 3, y: 300, z: 0 }, { x: 0, y: -1, z: 0 }, 1000)
  ).toBeNull();
});

test("a counter whose ground has not streamed in is not askable yet", () => {
  expect(
    bikeAskSets([counter], { ...ground, heightAt: () => null }, new Date())
  ).toEqual([]);
});
