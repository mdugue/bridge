import { describe, expect, test } from "bun:test";
import { Vector3, Vector4 } from "three/webgpu";
import {
  GLINT_EASE_S,
  glintEaser,
  packedReach,
  rankReflected,
  rankScratch,
  uniqueHeads,
} from "./lamp-reflections";

const slots = (n: number) => Array.from({ length: n }, () => new Vector4());
const eye = new Vector3(0, 10, 0);
const pick = { most: 4, reach: [250, 400] as const };
const along = (ds: number[]) => ds.map((d) => new Vector3(0, 8, -d));

describe("rankReflected", () => {
  test("keeps the nearest, whichever way they lie", () => {
    const heads = [
      new Vector3(0, 8, -300),
      new Vector3(0, 8, 30), // behind the usual look: kept too
      new Vector3(5, 8, -10),
    ];
    const out = slots(4);
    const n = rankReflected(heads, eye, pick, out, rankScratch());
    expect(n).toBe(3);
    expect(out[0].z).toBe(-10);
    expect(out[0].w).toBeCloseTo(1, 5);
  });

  test("fades the kept ones to nothing toward the first left out", () => {
    const out = slots(4);
    const n = rankReflected(
      along([10, 20, 30, 95, 100]),
      eye,
      pick,
      out,
      rankScratch()
    );
    expect(n).toBe(4);
    expect(out[0].w).toBeCloseTo(1, 5);
    // 95 m against a cut at 100 m: nearly gone
    expect(out[3].w).toBeLessThan(0.1);
  });

  test("walking on hands a lamp over without a jump", () => {
    // a row along a track, every 25 m; the eye walks along it
    const row = along(Array.from({ length: 40 }, (_, i) => i * 25 - 300));
    const fadeOf = (z: number) => {
      const out = slots(4);
      const n = rankReflected(
        row,
        new Vector3(0, 10, z),
        pick,
        out,
        rankScratch()
      );
      return new Map(out.slice(0, n).map((v) => [v.z, v.w]));
    };
    let last = fadeOf(0);
    for (let z = -0.5; z > -100; z -= 0.5) {
      const now = fadeOf(z);
      for (const lamp of new Set([...last.keys(), ...now.keys()])) {
        const step = Math.abs((now.get(lamp) ?? 0) - (last.get(lamp) ?? 0));
        expect(step).toBeLessThan(0.1);
      }
      last = now;
    }
  });

  test("fades far lamps with the reach", () => {
    const out = slots(4);
    rankReflected(along([380]), eye, pick, out, rankScratch());
    expect(out[0].w).toBeLessThan(0.1);
  });
});

describe("uniqueHeads", () => {
  test("drops a lamp two loaded levels both bring", () => {
    const heads = [
      new Vector3(1, 2, 3),
      new Vector3(1.01, 2, 3),
      new Vector3(4, 2, 3),
    ];
    expect(uniqueHeads(heads)).toHaveLength(2);
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
