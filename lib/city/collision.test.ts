import { expect, test } from "bun:test";
import { horizontalSlide } from "./collision";

test("head-on motion into a wall is cancelled", () => {
  // Wall normal points back at the player (+z); player walks -z.
  const result = horizontalSlide({ x: 0, z: -1 }, { x: 0, z: 1 });
  expect(result.x).toBeCloseTo(0);
  expect(result.z).toBeCloseTo(0);
});

test("diagonal motion keeps its tangential component", () => {
  const result = horizontalSlide({ x: 1, z: -1 }, { x: 0, z: 1 });
  expect(result.x).toBeCloseTo(1);
  expect(result.z).toBeCloseTo(0);
});

test("motion away from the wall is unchanged", () => {
  const move = { x: 0.3, z: 0.8 };
  expect(horizontalSlide(move, { x: 0, z: 1 })).toEqual(move);
});

test("unnormalized wall normals are handled", () => {
  const result = horizontalSlide({ x: 0, z: -2 }, { x: 0, z: 10 });
  expect(result.z).toBeCloseTo(0);
});

test("zero normal leaves the move unchanged", () => {
  const move = { x: 1, z: 2 };
  expect(horizontalSlide(move, { x: 0, z: 0 })).toEqual(move);
});

test("slide never increases the step length", () => {
  const move = { x: 0.7, z: -0.7 };
  const result = horizontalSlide(move, { x: 0.5, z: 0.86 });
  expect(Math.hypot(result.x, result.z)).toBeLessThanOrEqual(
    Math.hypot(move.x, move.z) + 1e-9
  );
});
