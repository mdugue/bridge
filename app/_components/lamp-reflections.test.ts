import { describe, expect, test } from "bun:test";
import { Vector3, Vector4 } from "three/webgpu";
import { rankReflected, rankScratch } from "./lamp-reflections";

const slots = (n: number) => Array.from({ length: n }, () => new Vector4());
const eye = new Vector3(0, 10, 0);
const north = new Vector3(0, 0, -1);
const view = { eye, look: north };
/** 16 slots: two per sector of the look */
const pick = { most: 16, reach: [1200, 1600] as const };

describe("rankReflected", () => {
  test("keeps the lamps in front, nearest first, and drops those behind", () => {
    const heads = [
      new Vector3(0, 8, -300),
      new Vector3(0, 8, 300), // behind
      new Vector3(5, 8, -100),
    ];
    const out = slots(16);
    const n = rankReflected(heads, view, pick, out, rankScratch());
    expect(n).toBe(2);
    expect(out[0].z).toBe(-100);
    expect(out[1].z).toBe(-300);
    expect(out[0].w).toBeCloseTo(1, 5);
  });

  test("mirrors a lamp close by whichever way the eye looks", () => {
    const out = slots(16);
    const n = rankReflected(
      [new Vector3(0, 8, 30)],
      view,
      pick,
      out,
      rankScratch()
    );
    expect(n).toBe(1);
  });

  test("keeps a share per sector, so a row across the view is kept all along", () => {
    // a quay 400 m ahead, a lamp every 10 m from 300 m left to 300 m right
    const row = Array.from(
      { length: 61 },
      (_, i) => new Vector3(-300 + i * 10, 8, -400)
    );
    const out = slots(16);
    const n = rankReflected(row, view, pick, out, rankScratch());
    expect(n).toBeGreaterThan(8);
    const xs = out.slice(0, n).map((v) => v.x);
    expect(Math.min(...xs)).toBeLessThan(-200);
    expect(Math.max(...xs)).toBeGreaterThan(200);
  });

  test("fades the last lamp of a sector toward the first one left out, and far ones", () => {
    const heads = [100, 200, 210].map((d) => new Vector3(0, 8, -d));
    const out = slots(16);
    const n = rankReflected(heads, view, pick, out, rankScratch());
    expect(n).toBe(2);
    expect(out[0].w).toBeCloseTo(1, 5);
    // 200 m, against a cut at 210 m: well inside the hand-over band
    expect(out[1].w).toBeLessThan(0.2);
    const far = slots(16);
    rankReflected([new Vector3(0, 8, -1500)], view, pick, far, rankScratch());
    expect(far[0].w).toBeLessThan(0.5);
  });

  test("looking straight down, every side counts", () => {
    const out = slots(16);
    const n = rankReflected(
      [new Vector3(0, 8, 300)],
      { eye, look: new Vector3(0, -1, 0) },
      pick,
      out,
      rankScratch()
    );
    expect(n).toBe(1);
  });
});
