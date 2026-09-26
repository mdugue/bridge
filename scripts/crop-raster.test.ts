import { expect, test } from "bun:test";
import sharp from "sharp";
import { decodeGreyPng } from "../lib/city/png-raster";
import { colonyCrop, cropColonyRaster, cropRg, halveRg } from "./crop-raster";

/** A 16² RG raster with one colony: R = 200 inside x 5–8, y 3–5. */
function raster(): Uint8Array {
  const rg = new Uint8Array(16 * 16 * 2);
  for (let y = 3; y <= 5; y++) {
    for (let x = 5; x <= 8; x++) {
      rg.set([200, 7], (y * 16 + x) * 2);
    }
  }
  return rg;
}

test("the crop keeps the colony and a margin, on even bounds", () => {
  // x 5–8 → 3–10 with the margin → [2, 12); y 3–5 → 1–7 → [0, 8)
  expect(colonyCrop(raster(), 16)).toEqual([2, 0, 10, 8, 16]);
  expect(colonyCrop(new Uint8Array(16 * 16 * 2), 16)).toBeNull();
});

test("the cropped texels are the source's, byte for byte", () => {
  const rg = raster();
  const cut = cropRg(rg, [2, 0, 10, 8, 16]);
  // texel (5, 3) of the tile is (3, 3) of the crop
  expect([...cut.subarray((3 * 10 + 3) * 2, (3 * 10 + 3) * 2 + 2)]).toEqual([
    200, 7,
  ]);
  expect(cut[0]).toBe(0); // the corner: margin, no colony
});

test("the half-resolution twin averages the distance and keeps the axis", () => {
  // one 2×2 block: 130, 140, 0 (far outside), 150 → (130+140+1+150)/4
  const rg = new Uint8Array([130, 5, 140, 5, 0, 0, 150, 5]);
  expect([...halveRg(rg, 2, 2)]).toEqual([105, 5]);
  expect([...halveRg(new Uint8Array(8), 2, 2)]).toEqual([0, 0]);
});

test("the published PNGs decode to the crop with the viewer's own decoder", async () => {
  const rg = raster();
  const png = await sharp(rg, { raw: { width: 32, height: 16, channels: 1 } })
    .png()
    .toBuffer();
  const out = await cropColonyRaster(png);
  expect(out?.crop).toEqual([2, 0, 10, 8, 16]);
  const full = await decodeGreyPng(new Uint8Array(out?.full ?? []));
  expect([full.width, full.height]).toEqual([20, 8]);
  expect([...full.data]).toEqual([...cropRg(rg, [2, 0, 10, 8, 16])]);
  const low = await decodeGreyPng(new Uint8Array(out?.low ?? []));
  expect([low.width, low.height]).toEqual([10, 4]);
});
