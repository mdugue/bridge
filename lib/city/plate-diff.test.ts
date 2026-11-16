/** Two plates compared: the level a pixel differs at, the share and the
 *  mean a view does, and the changes tier 1's numbers must not let pass. */
import { describe, expect, test } from "bun:test";
import {
  diffImage,
  diffPlates,
  plateBlank,
  plateDiffers,
  TIER1_TOLERANCE,
} from "./plate-diff";
import type { Plate } from "./plate-diff";

/** A grey plate, 10 × 10 unless said otherwise. */
function plate(value: number, width = 10, height = 10, channels: 3 | 4 = 3) {
  return {
    channels,
    data: new Uint8Array(width * height * channels).fill(value),
    height,
    width,
  } satisfies Plate;
}

/** `base` with its first `count` pixels' channel `c` moved by `by`. */
function moved(base: Plate, count: number, by: number, c = 1): Plate {
  const data = base.data.slice();
  for (let p = 0; p < count; p += 1) {
    data[p * base.channels + c] += by;
  }
  return { ...base, data };
}

const NO_MEAN = { mean: Number.POSITIVE_INFINITY };

describe("diffPlates", () => {
  test("equal plates differ in nothing", () => {
    const diff = diffPlates(plate(100), plate(100), 24);
    expect(diff).toMatchObject({
      differing: 0,
      max: 0,
      mean: 0,
      pixels: 100,
      share: 0,
    });
    expect(plateDiffers(diff, { mean: 0, share: 0 })).toBe(false);
  });

  test("a pixel differs above the level, not at it", () => {
    const base = plate(100);
    const at = diffPlates(base, moved(base, 1, 24), 24);
    // under the level a difference is still measured
    expect(at).toMatchObject({ differing: 0, max: 24, mean: 0.24 });
    const over = diffPlates(base, moved(base, 1, 25), 24);
    expect(over).toMatchObject({ differing: 1, max: 25, share: 0.01 });
    expect(over.levels[0]).toBe(25);
    expect(over.levels[1]).toBe(0);
  });

  test("each colour channel counts alone, either way round", () => {
    const base = plate(100);
    for (const channel of [0, 1, 2]) {
      const other = moved(base, 1, -60, channel);
      expect(diffPlates(base, other, 24)).toMatchObject({
        differing: 1,
        max: 60,
      });
      expect(diffPlates(other, base, 24).max).toBe(60);
    }
    // the largest of the three, not their sum
    const two = moved(moved(base, 1, -60, 1), 1, 5, 0);
    expect(diffPlates(base, two, 24).max).toBe(60);
  });

  test("a view differs above the share, not at it", () => {
    const base = plate(100);
    const tolerance = { ...NO_MEAN, share: 0.05 };
    expect(
      plateDiffers(diffPlates(base, moved(base, 5, 50), 24), tolerance)
    ).toBe(false);
    expect(
      plateDiffers(diffPlates(base, moved(base, 6, 50), 24), tolerance)
    ).toBe(true);
  });

  test("a view differs above the mean, with no pixel over the level", () => {
    const base = plate(100);
    // every pixel 2 steps off: none over the level of 24
    const diff = diffPlates(base, plate(102), 24);
    expect(diff).toMatchObject({ differing: 0, mean: 2 });
    expect(plateDiffers(diff, { mean: 2, share: 1 })).toBe(false);
    expect(plateDiffers(diff, { mean: 1.9, share: 1 })).toBe(true);
  });

  test("alpha is not compared, and RGB meets RGBA", () => {
    const rgba = plate(100, 10, 10, 4);
    for (let p = 0; p < 100; p += 1) {
      rgba.data[p * 4 + 3] = 0;
    }
    expect(diffPlates(plate(100), rgba, 0).differing).toBe(0);
    expect(diffPlates(plate(100), moved(rgba, 1, 9, 2), 0).differing).toBe(1);
  });

  test("plates of different size are an error, not a difference", () => {
    expect(() => diffPlates(plate(1, 10, 10), plate(1, 10, 11), 24)).toThrow(
      "different size"
    );
    expect(() =>
      diffPlates(plate(1), { ...plate(1), data: new Uint8Array(7) }, 24)
    ).toThrow("does not match");
  });
});

const W = 800;
const H = 500;
/** Whether tier 1 calls the two plates different. */
const differs = (a: Plate, b: Plate) =>
  plateDiffers(diffPlates(a, b, TIER1_TOLERANCE.level), TIER1_TOLERANCE);
const frame = () => plate(100, W, H);
/** `fn` over each pixel's offset of a copy of the base. */
const edited = (fn: (data: Uint8Array, i: number, p: number) => void) => {
  const next = frame();
  for (let p = 0; p < W * H; p += 1) {
    fn(next.data, p * 3, p);
  }
  return next;
};
/** The base with its first `count` pixels' red 50 up. */
const some = (count: number) =>
  edited((d, i, p) => {
    if (p < count) {
      d[i] += 50;
    }
  });

describe("tier 1's tolerance", () => {
  test("the numbers, pinned", () => {
    expect(TIER1_TOLERANCE).toEqual({ level: 3, mean: 0.1, share: 1e-5 });
  });

  // The independent review's five (2026-11-16): each passed as "same"
  // under the first tolerance, 24 of 255 and 20 pixels.
  test("the whole frame 24 brighter differs", () => {
    expect(differs(frame(), plate(124, W, H))).toBe(true);
  });

  test("red up and green down by 24 differs", () => {
    const shifted = edited((d, i) => {
      d[i] += 24;
      d[i + 1] -= 24;
    });
    expect(differs(frame(), shifted)).toBe(true);
  });

  test("the lower half 20 brighter differs", () => {
    const half = edited((d, i, p) => {
      if (p >= (W * H) / 2) {
        d[i] += 20;
        d[i + 1] += 20;
        d[i + 2] += 20;
      }
    });
    expect(differs(frame(), half)).toBe(true);
  });

  test("a white object of twenty pixels differs", () => {
    const object = edited((d, i, p) => {
      if (p >= 1000 && p < 1020) {
        d.fill(255, i, i + 3);
      }
    });
    expect(differs(frame(), object)).toBe(true);
  });

  test("a line across the frame, 24 brighter, differs", () => {
    const line = edited((d, i, p) => {
      if (Math.floor(p / W) === 250) {
        d[i + 1] += 24;
      }
    });
    expect(differs(frame(), line)).toBe(true);
  });

  test("the whole frame one step brighter differs, by the mean", () => {
    const diff = diffPlates(frame(), plate(101, W, H), TIER1_TOLERANCE.level);
    expect(diff.differing).toBe(0);
    expect(plateDiffers(diff, TIER1_TOLERANCE)).toBe(true);
  });

  test("one drawn pixel (four of the plate's) differs only past four", () => {
    expect(differs(frame(), some(4))).toBe(false);
    expect(differs(frame(), some(5))).toBe(true);
  });

  test("the measured floor passes: three pixels by one step", () => {
    const floor = edited((d, i, p) => {
      if (p < 3) {
        d[i + 2] += 1;
      }
    });
    expect(differs(frame(), floor)).toBe(false);
  });
});

describe("plateBlank", () => {
  test("a plate of one colour is blank, a drawn one is not", () => {
    expect(plateBlank(plate(0))).toBe(true);
    expect(plateBlank(moved(plate(200), 100, 2))).toBe(true);
    expect(plateBlank(moved(plate(200), 1, 3, 2))).toBe(false);
    // alpha does not make a picture
    const rgba = plate(7, 4, 4, 4);
    rgba.data[3] = 255;
    expect(plateBlank(rgba)).toBe(true);
  });
});

describe("diffImage", () => {
  test("marks the pixels over the level in red on the pale head", () => {
    const base = plate(100);
    // two pixels over the level, a third exactly at it
    const head = moved(base, 2, 80);
    head.data[6] += 24;
    const image = diffImage(head, diffPlates(base, head, 24), 24);
    expect(image).toMatchObject({ channels: 3, height: 10, width: 10 });
    expect(Array.from(image.data.slice(0, 6))).toEqual([220, 0, 0, 220, 0, 0]);
    const [r, g, b] = image.data.slice(6, 9);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(160);
  });
});
