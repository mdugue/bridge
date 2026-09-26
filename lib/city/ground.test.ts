import { expect, test } from "bun:test";
import { createGround } from "./ground";

const offset = { cx: 1000, cy: 2000 };
// A fine tile over x ≥ 1000 at 110 m, a coarse one everywhere at 100 m.
const fine = { heightAt: (x: number) => (x >= 1000 ? 110 : null) };
const coarse = { heightAt: () => 100 };

test("the first source that covers a point wins", () => {
  const ground = createGround(offset);
  expect(ground.heightAt(1500, 2000)).toBeNull();
  ground.setSources([fine, coarse]);
  expect(ground.heightAt(1500, 2000)).toBe(110);
  expect(ground.heightAt(500, 2000)).toBe(100);
});

test("world coordinates go through the recenter offset (z is −north)", () => {
  const ground = createGround(offset);
  ground.setSources([fine]);
  expect(ground.atWorld(10, 0)).toBe(110); // x 1010
  expect(ground.atWorld(-10, 0)).toBeNull(); // x 990
});

test("off every source the floor stands in, then 0", () => {
  const ground = createGround(offset);
  expect(ground.floor()).toBeNull();
  expect(ground.underWorld(0, 0)).toBe(0);
  expect(ground.lowerFloor(104)).toBe(true);
  expect(ground.lowerFloor(108)).toBe(false);
  expect(ground.floor()).toBe(104);
  expect(ground.underWorld(-10, 0)).toBe(104);
});

test("a ray straight down meets the ground at its height", () => {
  const ground = createGround(offset);
  ground.setSources([coarse]);
  const d = ground.along({ x: 0, y: 150, z: 0 }, { x: 0, y: -1, z: 0 }, 500);
  expect(d).not.toBeNull();
  expect(d ?? 0).toBeCloseTo(50, 0);
  expect(
    ground.along({ x: 0, y: 150, z: 0 }, { x: 0, y: 1, z: 0 }, 500)
  ).toBeNull();
});
