import { describe, expect, test } from "bun:test";
import { noiseTextureBytes, sampleNoise } from "./noise-texture";

const SIZE = 64;
const bytes = noiseTextureBytes(SIZE);

describe("the noise texture", () => {
  test("G is the next z slice of R: the noise is continuous across z", () => {
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const x = (i * 7.31) % SIZE;
      const y = (i * 3.77) % SIZE;
      const z = Math.floor(i / 7) + 1;
      worst = Math.max(
        worst,
        Math.abs(
          sampleNoise(bytes, SIZE, x, y, z - 1e-6) -
            sampleNoise(bytes, SIZE, x, y, z)
        )
      );
    }
    expect(worst).toBeLessThan(1e-3);
  });

  test("is spread around zero", () => {
    let sum = 0;
    let n = 0;
    for (let x = 0; x < 40; x += 0.37) {
      for (let z = 0; z < 6; z += 0.53) {
        sum += sampleNoise(bytes, SIZE, x, x * 0.7, z);
        n += 1;
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.1);
  });

  test("is the same for the same seed", () => {
    expect(noiseTextureBytes(8, 7)).toEqual(noiseTextureBytes(8, 7));
  });
});
