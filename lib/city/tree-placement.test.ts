import { describe, expect, test } from "bun:test";
import type { CanopyFeature } from "./features";
import {
  BASE_TREE_H,
  CROWN_TO_HEIGHT,
  canopyCrownWidth,
  canopyPlacements,
  GENERIC_CROWN_W,
} from "./tree-placement";

const ctx = { heightAt: () => 100, offset: { cx: 0, cy: 0 } };

function point(h: number, r?: number): CanopyFeature {
  return {
    geometry: { type: "Point", coordinates: [10, 20] },
    properties: r === undefined ? { h } : ({ h, r } as { h: number }),
  };
}

describe("canopy placements", () => {
  test("a canopy tree stands as tall as measured, 0.58 of it wide", () => {
    const [p] = canopyPlacements([point(20)], ctx);
    const height = p.s * BASE_TREE_H;
    const width = (p.w ?? p.s) * GENERIC_CROWN_W;
    // ± the 10 % jitter on each
    expect(height).toBeGreaterThan(18);
    expect(height).toBeLessThan(22);
    expect(width / height).toBeGreaterThan(CROWN_TO_HEIGHT * 0.9 * 0.9);
    expect(width / height).toBeLessThan(CROWN_TO_HEIGHT * 1.1 * 1.1);
  });

  test("a laser-scan crown takes its measured radius, within bounds", () => {
    expect(canopyCrownWidth(20, 5, 0.5)).toBeCloseTo(10);
    // a 1 m radius on a 20 m tree is the peak's knob, not its crown
    expect(canopyCrownWidth(20, 1, 0.5)).toBeCloseTo(8);
    // a group's radius is not one tree's crown
    expect(canopyCrownWidth(20, 12, 0.5)).toBeCloseTo(15);
    expect(canopyCrownWidth(20, undefined, 0.5)).toBeCloseTo(
      20 * CROWN_TO_HEIGHT
    );
  });
});
