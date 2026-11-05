import { describe, expect, test } from "bun:test";
import { Vector3, Vector4 } from "three/webgpu";
import { rankReflected, rankScratch } from "./lamp-reflections";

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
