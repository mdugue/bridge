import { expect, test } from "bun:test";
import {
  chooseSample,
  firstSolid,
  mergeCandidates,
  type PickSample,
  ringOffsets,
} from "./inquiry-probe";

const s = (
  key: string,
  distance: number,
  porous = false
): PickSample<string> => ({
  key,
  distance,
  hit: `${key}@${distance}`,
  porous,
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

test("a crown in front does not take the click from the house behind it", () => {
  const tree = s("tree", 12, true);
  const house = s("house", 20);
  expect(firstSolid([tree, house])?.key).toBe("house");
  // nothing solid behind: the tree itself
  expect(firstSolid([tree])?.key).toBe("tree");
  expect(firstSolid([])).toBeNull();
});

test("the candidates: each thing once at its nearest, front to back, the chosen never cut", () => {
  const chosen = s("house", 20);
  const exact = [s("tree", 12, true), chosen, s("house", 31), s("back", 60)];
  const rings = [
    [s("lamp", 9), s("tree", 11, true), s("far", 90)],
    [s("tree", 13, true)],
  ];
  expect(mergeCandidates(chosen, exact, rings).map((c) => c.hit)).toEqual([
    "lamp@9",
    "tree@11",
    "house@20",
    "back@60",
  ]);
  // past the cap the farthest go, but not the chosen one
  const far = s("x", 500);
  const many = Array.from({ length: 10 }, (_, i) => s(`n${i}`, i));
  const kept = mergeCandidates(far, [...many, far], [], 4);
  expect(kept.map((c) => c.key)).toEqual(["n0", "n1", "n2", "x"]);
});
