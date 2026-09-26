import { expect, test } from "bun:test";
import type { InstancedMesh } from "three";
import type { FurnitureFeature } from "@/lib/city/features";
import { buildFurniture, setClockTime } from "./furniture-layer";

const ctx = { offset: { cx: 0, cy: 0 }, heightAt: () => 100 };

const at = (
  properties: FurnitureFeature["properties"],
  x = 0
): FurnitureFeature => ({
  geometry: { type: "Point", coordinates: [x, 0] },
  properties,
});

test("the street's signs and fixtures each build an instanced model", () => {
  const group = buildFurniture(
    [
      at({ k: "column" }),
      at({ k: "column", lit: true }, 5),
      at({ k: "signal", a: 90 }, 10),
      at({ k: "hydrant" }, 15),
      at({ k: "hydrantsign", a: 0 }, 20),
      at({ k: "clock", a: 0 }, 25),
      at({ k: "wallclock", a: 180 }, 30),
      at({ k: "water", a: 0 }, 35),
      at({ k: "stop", a: 0 }, 40),
    ],
    ctx
  );
  const names = group.children.map((c) => c.name).toSorted();
  expect(names).toEqual(
    [
      "furniture-clock",
      "furniture-clock-hands",
      "furniture-column",
      "furniture-columnLit",
      "furniture-hydrant",
      "furniture-hydrantSign",
      "furniture-signal",
      "furniture-stop",
      "furniture-wallClock",
      "furniture-wallClock-hands",
      "furniture-water",
    ].toSorted()
  );
  for (const child of group.children as InstancedMesh[]) {
    // the hands never cast: the shadow map is not redrawn every minute
    expect(child.castShadow).toBe(!child.name.endsWith("-hands"));
    expect(child.count).toBe(1);
  }
});

test("the clock hands move on the minute only", () => {
  const t = new Date(2026, 5, 15, 14, 30, 5);
  setClockTime(t);
  expect(setClockTime(new Date(2026, 5, 15, 14, 30, 50))).toBe(false);
  expect(setClockTime(new Date(2026, 5, 15, 14, 31, 0))).toBe(true);
  // 2:31 and 14:31 read the same on a dial
  expect(setClockTime(new Date(2026, 5, 15, 2, 31, 0))).toBe(false);
});
