import { expect, test } from "bun:test";
import { SRGBColorSpace } from "three/webgpu";
import { WATER_SHEET } from "@/lib/city/water-bodies";
import { tintTexture } from "./water-layer";

const rgbOf = (data: Uint8Array, i: number) =>
  (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];

test("a tile without a tint gets one texel of the sheet's colour", () => {
  const t = tintTexture(undefined);
  const { data, width } = t.image as { data: Uint8Array; width: number };
  expect(width).toBe(1);
  expect(rgbOf(data, 0)).toBe(WATER_SHEET);
  expect(t.colorSpace).toBe(SRGBColorSpace);
  expect(t.flipY).toBe(false);
});

test("each tint cell takes its body's colour, the sheet's where none", () => {
  // 2 × 2: body 1, none, body 2, body 1 (row 0 = north)
  const cells = btoa(String.fromCharCode(1, 0, 2, 1));
  const t = tintTexture({
    tint: { n: 2, cells, colours: [0xa8_98_76, 0x7f_a8_88] },
  });
  const { data } = t.image as { data: Uint8Array };
  expect([0, 1, 2, 3].map((i) => rgbOf(data, i))).toEqual([
    0xa8_98_76,
    WATER_SHEET,
    0x7f_a8_88,
    0xa8_98_76,
  ]);
});
