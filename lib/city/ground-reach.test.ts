import { describe, expect, test } from "bun:test";
import {
  FAR_ABOVE_M,
  NEAR_BELOW_M,
  metresPerPixel,
  readsFar,
} from "./ground-reach";

const box = { min: [0, 100, 0], max: [2000, 140, 2000] } as const;

describe("metresPerPixel", () => {
  test("a tile the eye stands in is drawn as finely as can be", () => {
    expect(
      metresPerPixel(
        {
          kind: "perspective",
          eye: [500, 120, 500],
          fovDeg: 62,
          heightPx: 1080,
        },
        box
      )
    ).toBe(0);
  });

  test("grows with the distance to the tile's nearest point", () => {
    const at = (x: number) =>
      metresPerPixel(
        {
          kind: "perspective",
          eye: [x, 120, 1000],
          fovDeg: 62,
          heightPx: 1080,
        },
        box
      );
    // 675 m off its edge, a 1080 px frame at 62°: 0.75 m a pixel
    expect(at(-675)).toBeCloseTo(0.751, 2);
    expect(at(-1350)).toBeCloseTo(2 * at(-675), 6);
    // twice the pixels, half the span
    expect(
      metresPerPixel(
        {
          kind: "perspective",
          eye: [-675, 120, 1000],
          fovDeg: 62,
          heightPx: 2160,
        },
        box
      )
    ).toBeCloseTo(at(-675) / 2, 6);
  });

  test("the height over the tile counts", () => {
    expect(
      metresPerPixel(
        {
          kind: "perspective",
          eye: [500, 440, 500],
          fovDeg: 62,
          heightPx: 1080,
        },
        box
      )
    ).toBeCloseTo((300 * 2 * Math.tan((31 * Math.PI) / 180)) / 1080, 6);
  });

  test("a parallel view draws every tile alike", () => {
    expect(
      metresPerPixel(
        { kind: "parallel", worldHeight: 1600, heightPx: 800 },
        box
      )
    ).toBe(2);
  });
});

describe("readsFar", () => {
  test("a tile that lands takes the set its distance asks for", () => {
    expect(readsFar(0.2, undefined)).toBe(false);
    expect(readsFar(NEAR_BELOW_M, undefined)).toBe(true);
  });

  test("between the two marks a tile keeps what it reads", () => {
    const between = (NEAR_BELOW_M + FAR_ABOVE_M) / 2;
    expect(readsFar(between, true)).toBe(true);
    expect(readsFar(between, false)).toBe(false);
    expect(readsFar(NEAR_BELOW_M - 0.01, true)).toBe(false);
    expect(readsFar(FAR_ABOVE_M + 0.01, false)).toBe(true);
  });
});
