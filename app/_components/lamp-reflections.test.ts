import { describe, expect, test } from "bun:test";
import { Vector3, Vector4 } from "three/webgpu";
import {
  GLINT_EASE_S,
  glintEaser,
  packedReach,
  rankReflected,
  rankScratch,
} from "./lamp-reflections";

const slots = (n: number) => Array.from({ length: n }, () => new Vector4());
const eye = new Vector3(0, 10, 0);
/** 48 slots: two per compass sector of 15° */
const pick = { most: 48, reach: [1200, 1600] as const };

describe("rankReflected", () => {
  test("keeps each sector's nearest, whichever way they lie", () => {
    const heads = [
      new Vector3(0, 8, -300),
      new Vector3(0, 8, 300), // behind the usual look: kept too
      new Vector3(5, 8, -100),
    ];
    const out = slots(48);
    const n = rankReflected(heads, eye, pick, out, rankScratch());
    expect(n).toBe(3);
    expect(out[0].z).toBe(-100);
    expect(out[0].w).toBeCloseTo(1, 5);
  });

  test("keeps a share per sector, so a row across the view is kept all along", () => {
    // a quay 400 m ahead, a lamp every 10 m from 300 m left to 300 m right
    const row = Array.from(
      { length: 61 },
      (_, i) => new Vector3(-300 + i * 10, 8, -400)
    );
    const out = slots(48);
    const n = rankReflected(
      row,
      eye,
      { most: 48, reach: [1200, 1600] },
      out,
      rankScratch()
    );
    expect(n).toBeGreaterThan(8);
    const xs = out.slice(0, n).map((v) => v.x);
    expect(Math.min(...xs)).toBeLessThan(-200);
    expect(Math.max(...xs)).toBeGreaterThan(200);
  });

  test("fades the last lamp of a sector toward the first one left out, and far ones", () => {
    const heads = [100, 200, 210].map((d) => new Vector3(0, 8, -d));
    const out = slots(48);
    const n = rankReflected(heads, eye, pick, out, rankScratch());
    expect(n).toBe(2);
    expect(out[0].w).toBeCloseTo(1, 5);
    // 200 m, against a cut at 210 m: well inside the hand-over band
    expect(out[1].w).toBeLessThan(0.2);
    const far = slots(48);
    rankReflected([new Vector3(0, 8, -1500)], eye, pick, far, rankScratch());
    expect(far[0].w).toBeLessThan(0.5);
  });
});

describe("packedReach", () => {
  test("packs eight sectors' reaches, four 6-bit steps a float", () => {
    const [lo, hi] = packedReach([5, 10, 0, 300, 0, 0, 7, 1000]);
    expect(lo).toBe(1 + 2 * 64 + 60 * 64 ** 3);
    // 7 m rounds up to two steps; past 63 steps the most
    expect(hi).toBe(2 * 64 ** 2 + 63 * 64 ** 3);
    expect(hi).toBeLessThan(2 ** 24);
  });

  test("a lamp without the bake's reach reaches as far as it looks", () => {
    const steps = 63 * (1 + 64 + 64 ** 2 + 64 ** 3);
    expect(packedReach(null)).toEqual([steps, steps]);
  });
});

const lamp = (x: number, w = 1) => new Vector4(x, 5, 0, w);

describe("glintEaser", () => {
  test("a lamp the choice takes up fades in, one it lets go fades out", () => {
    const ease = glintEaser(4);
    const out = slots(4);
    // the first frame shows the choice as it is
    expect(ease([lamp(0)], 1, 0, out)).toBe(1);
    expect(out[0].w).toBeCloseTo(1, 5);
    // a frame later the choice swaps lamp 0 for lamp 10: both show, eased
    expect(ease([lamp(10)], 1, 1 / 60, out)).toBe(2);
    const shown = new Map(out.slice(0, 2).map((v) => [v.x, v.w]));
    expect(shown.get(0)).toBeGreaterThan(0.9);
    expect(shown.get(10)).toBeLessThan(0.1);
    // after six of the ease's times only the new one is left
    expect(ease([lamp(10)], 1, 6 * GLINT_EASE_S, out)).toBe(1);
    expect(out[0].x).toBe(10);
    expect(out[0].w).toBeGreaterThan(0.95);
  });

  test("never more than its slots, the brightest first", () => {
    const ease = glintEaser(2);
    const out = slots(2);
    ease([lamp(0), lamp(1)], 2, 0, out);
    expect(ease([lamp(2), lamp(3)], 2, 0.1, out)).toBe(2);
    expect(out.map((v) => v.x).toSorted((a, b) => a - b)).toEqual([0, 1]);
  });
});
