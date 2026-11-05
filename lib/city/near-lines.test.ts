import { describe, expect, test } from "bun:test";
import { nearLines } from "./near-lines";

describe("nearLines", () => {
  const track = [
    [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
  ] as const;
  const near = nearLines(track, 20);

  test("finds points within reach of a segment, past its cells too", () => {
    expect(near(50, 15)).toBe(true);
    expect(near(115, 60)).toBe(true);
    // beyond the line's end, within reach of its last point
    expect(near(-12, 10)).toBe(true);
  });

  test("misses points out of reach", () => {
    expect(near(50, 25)).toBe(false);
    expect(near(50, 50)).toBe(false);
    expect(near(-20, -20)).toBe(false);
  });

  test("finds nothing without lines", () => {
    expect(nearLines([], 20)(0, 0)).toBe(false);
  });
});
