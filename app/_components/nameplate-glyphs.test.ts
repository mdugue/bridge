import { expect, test } from "bun:test";
import { shadowMask } from "./nameplate-glyphs";

/** One quad's corners (x, y, 0 each), counter-clockwise from its foot. */
const quad = (x0: number, y0: number, x1: number, y1: number) => [
  x0,
  y0,
  0,
  x1,
  y0,
  0,
  x1,
  y1,
  0,
  x0,
  y1,
  0,
];

test("the shadow mask covers what the quads cast, row 0 at the foot", () => {
  // a solid over the block's left half, a glyph's coverage (solid at its
  // top row only) over the right half's upper part
  const cover = {
    data: new Uint8Array([255, 255, 0, 0]),
    f: 1,
    width: 2,
    height: 2,
  };
  const mask = shadowMask(
    new Float32Array([...quad(0, 0, 2, 2), ...quad(2, 1, 4, 2)]),
    ["solid", cover],
    { x: 0, y: 0, width: 4, height: 2 }
  );
  expect(mask.width).toBe(48);
  expect(mask.height).toBe(24);
  const at = (x: number, y: number) =>
    mask.data[Math.floor(y * 12) * mask.width + Math.floor(x * 12)];
  expect(at(1, 1)).toBe(255);
  expect(at(3, 0.5)).toBe(0);
  // the glyph's top row lies in the plate's upper half
  expect(at(3, 1.8)).toBe(255);
  expect(at(3, 1.2)).toBe(0);
});

test("a long block's mask stays within its largest size", () => {
  const mask = shadowMask(new Float32Array(quad(0, 0, 80, 3)), ["solid"], {
    x: 0,
    y: 0,
    width: 80,
    height: 3,
  });
  expect(mask.width).toBeLessThanOrEqual(512);
  expect(mask.height).toBeLessThanOrEqual(128);
  expect(mask.data[Math.floor(mask.height / 2) * mask.width + 100]).toBe(255);
});

test("the mask covers its own area, beyond the block where a box reaches", () => {
  // a box reaching one cap left of and below the block's corner
  const mask = shadowMask(new Float32Array(quad(-1, -1, 1, 1)), ["solid"], {
    x: -1,
    y: -1,
    width: 2,
    height: 2,
  });
  expect(mask.area.x).toBe(-1);
  expect(mask.data[1 * mask.width + 1]).toBe(255);
});
