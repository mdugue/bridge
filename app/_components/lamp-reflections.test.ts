import { describe, expect, test } from "bun:test";
import { Vector3, Vector4 } from "three/webgpu";
import { rankReflected } from "./lamp-reflections";

const scratch = (n: number) => ({
  idx: Array.from({ length: n + 1 }, () => -1),
  dist: Array.from({ length: n + 1 }, () => Number.POSITIVE_INFINITY),
  front: Array.from({ length: n + 1 }, () => 0),
});
const slots = (n: number) => Array.from({ length: n }, () => new Vector4());
const eye = new Vector3(0, 10, 0);
const north = new Vector3(0, 0, -1);

describe("rankReflected", () => {
  test("keeps the lamps in front, nearest first, and drops those behind", () => {
    const heads = [
      new Vector3(0, 8, -300),
      new Vector3(0, 8, 300), // behind
      new Vector3(20, 8, -100),
    ];
    const out = slots(4);
    const n = rankReflected(heads, eye, north, 4, out, scratch(4));
    expect(n).toBe(2);
    expect(out[0].z).toBe(-100);
    expect(out[1].z).toBe(-300);
    expect(out[0].w).toBeCloseTo(1, 5);
  });

  test("mirrors a lamp close by whichever way the eye looks", () => {
    const out = slots(2);
    const n = rankReflected(
      [new Vector3(0, 8, 30)],
      eye,
      north,
      2,
      out,
      scratch(2)
    );
    expect(n).toBe(1);
  });

  test("fades the last lamps toward the first one left out, and far ones", () => {
    const heads = [100, 200, 210, 1500].map((d) => new Vector3(0, 8, -d));
    const out = slots(2);
    const n = rankReflected(heads, eye, north, 2, out, scratch(2));
    expect(n).toBe(2);
    expect(out[0].w).toBeCloseTo(1, 5);
    // 200 m, against a cut at 210 m: well inside the hand-over band
    expect(out[1].w).toBeLessThan(0.2);
    const far = slots(1);
    rankReflected([heads[3]], eye, north, 1, far, scratch(1));
    expect(far[0].w).toBeLessThan(0.5);
  });

  test("looking straight down, every side counts", () => {
    const out = slots(1);
    const n = rankReflected(
      [new Vector3(0, 8, 300)],
      eye,
      new Vector3(0, -1, 0),
      1,
      out,
      scratch(1)
    );
    expect(n).toBe(1);
  });
});
