import { expect, test } from "bun:test";
import { chooseSample, type PickSample, ringOffsets } from "./inquiry-probe";

const s = (key: string, distance: number): PickSample<string> => ({
  key,
  distance,
  hit: `${key}@${distance}`,
});

test("off target, the tree most ring rays hit wins, nearest hit on a tie", () => {
  expect(chooseSample([s("a", 50), s("b", 20), s("a", 45)])?.hit).toBe("a@45");
  expect(chooseSample([s("a", 50), s("b", 20)])?.hit).toBe("b@20");
  expect(chooseSample([])).toBeNull();
});

test("the rings sit at half and full radius, in NDC of the viewport", () => {
  const offsets = ringOffsets(20, { width: 400, height: 200 });
  expect(offsets).toHaveLength(16);
  // first ray of the inner ring: 10 px right = 0.05 NDC on a 400 px width
  expect(offsets[0].x).toBeCloseTo(0.05, 10);
  expect(offsets[0].y).toBeCloseTo(0, 10);
  const radii = offsets.map((o) => Math.hypot(o.x * 200, o.y * 100));
  expect(Math.min(...radii)).toBeCloseTo(10, 6);
  expect(Math.max(...radii)).toBeCloseTo(20, 6);
});
