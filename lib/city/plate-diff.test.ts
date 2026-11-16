/** Two plates compared: the level a pixel differs at, the share a view does. */
import { describe, expect, test } from "bun:test";
import { diffImage, diffPlates, plateDiffers } from "./plate-diff";
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

/** `base` with its first `count` pixels' green channel moved by `by`. */
function moved(base: Plate, count: number, by: number): Plate {
  const data = base.data.slice();
  for (let p = 0; p < count; p += 1) {
    data[p * base.channels + 1] += by;
  }
  return { ...base, data };
}

describe("diffPlates", () => {
  test("equal plates differ in nothing", () => {
    const diff = diffPlates(plate(100), plate(100), 24);
    expect(diff).toMatchObject({ differing: 0, max: 0, pixels: 100, share: 0 });
    expect(plateDiffers(diff, 0)).toBe(false);
  });

  test("a pixel differs above the level, not at it", () => {
    const base = plate(100);
    expect(diffPlates(base, moved(base, 1, 24), 24).differing).toBe(0);
    const over = diffPlates(base, moved(base, 1, 25), 24);
    expect(over).toMatchObject({ differing: 1, max: 25, share: 0.01 });
    expect(over.levels[0]).toBe(25);
    expect(over.levels[1]).toBe(0);
  });

  test("the largest channel counts, either way round", () => {
    const base = plate(100);
    const other = moved(base, 1, -60);
    other.data[0] += 5;
    expect(diffPlates(base, other, 24).max).toBe(60);
    expect(diffPlates(other, base, 24).max).toBe(60);
  });

  test("a view differs above the share, not at it", () => {
    const base = plate(100);
    const share = 0.05;
    expect(plateDiffers(diffPlates(base, moved(base, 5, 50), 24), share)).toBe(
      false
    );
    expect(plateDiffers(diffPlates(base, moved(base, 6, 50), 24), share)).toBe(
      true
    );
  });

  test("alpha is not compared, and RGB meets RGBA", () => {
    const rgba = plate(100, 10, 10, 4);
    for (let p = 0; p < 100; p += 1) {
      rgba.data[p * 4 + 3] = 0;
    }
    expect(diffPlates(plate(100), rgba, 0).differing).toBe(0);
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

describe("diffImage", () => {
  test("marks the pixels over the level in red on the pale head", () => {
    const base = plate(100);
    const head = moved(base, 2, 80);
    const image = diffImage(head, diffPlates(base, head, 24), 24);
    expect(image).toMatchObject({ channels: 3, height: 10, width: 10 });
    expect(Array.from(image.data.slice(0, 3))).toEqual([220, 0, 0]);
    const [r, g, b] = image.data.slice(6, 9);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(160);
  });
});
