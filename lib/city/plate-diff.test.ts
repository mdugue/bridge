/** Two plates compared: the level a pixel differs at, the share and the
 *  mean a view does, and the changes tier 1's numbers must not let pass. */
import { describe, expect, test } from "bun:test";
import { diffImage, diffPlates, plateBlank, plateDiffers } from "./plate-diff";
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

  test("plates of different size are an error, not a difference", () => {
    expect(() => diffPlates(plate(1, 10, 10), plate(1, 10, 11), 24)).toThrow(
      "different size"
    );
    expect(() =>
      diffPlates(plate(1), { ...plate(1), data: new Uint8Array(7) }, 24)
    ).toThrow("does not match");
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
