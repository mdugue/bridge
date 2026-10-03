import { expect, test } from "bun:test";
import { Texture } from "three/webgpu";
import { RasterShares } from "./raster-shares";
import { trackTexture } from "./three-utils";

const MB = 1024 * 1024;

function raster(bytes: number): Texture {
  const texture = new Texture();
  trackTexture(texture, bytes);
  return texture;
}

test("a raster held by one terrain level weighs whole", () => {
  const shares = new RasterShares();
  const splat = raster(16 * MB);
  expect(shares.hold("fine", [splat])).toEqual([]);
  expect(shares.bytesOf([splat])).toBe(16 * MB);
});

test("two levels holding one raster weigh half each; one letting go hands the other the whole", () => {
  const shares = new RasterShares();
  const splat = raster(16 * MB);
  const ndvi = raster(4 * MB);
  shares.hold("coarse", [splat, ndvi]);
  // the fine level arrives: the coarse one's share changed, reweigh it
  expect(shares.hold("fine", [splat])).toEqual(["coarse"]);
  expect(shares.bytesOf([splat])).toBe(8 * MB);
  expect(shares.bytesOf([splat, ndvi])).toBe(12 * MB);
  expect(shares.release("fine", [splat])).toEqual(["coarse"]);
  expect(shares.bytesOf([splat, ndvi])).toBe(20 * MB);
});

test("the last holder letting go has nobody left to reweigh", () => {
  const shares = new RasterShares();
  const splat = raster(16 * MB);
  shares.hold("coarse", [splat]);
  shares.hold("fine", [splat]);
  expect(shares.release("coarse", [splat])).toEqual(["fine"]);
  expect(shares.release("fine", [splat])).toEqual([]);
});
