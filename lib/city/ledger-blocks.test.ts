import { expect, test } from "bun:test";
import { siteBlocks } from "./ledger-blocks";
import type { TileBlocks } from "./ledger-blocks";

const tile = (png: number[], bc4: number[], eac: number[]): TileBlocks => ({
  png: { data: new Uint8Array(png), wire: 10, gpu: 4 },
  formats: {
    bc4: { decoded: new Float64Array(bc4), wire: 12, gpu: 2, mipsMax: 3 },
    eac: { decoded: new Float64Array(eac), wire: 11, gpu: 2, mipsMax: 1 },
  },
});

test("a site's bytes add up and its error is over every texel", () => {
  const site = siteBlocks([
    tile([10, 20, 30, 40], [10, 21, 30, 40], [10, 20, 30, 40.5]),
    tile([0, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0]),
  ]);
  expect(site.tiles).toBe(2);
  expect(site.png).toEqual({ wire: 20, gpu: 8 });
  expect(site.bc4).toEqual({
    wire: 24,
    gpu: 4,
    // (1 + 2) / 8 texels; the p99 of four texels is the third largest
    error: { mean: 0.375, p99: 0, max: 2, mipsMax: 3 },
  });
  expect(site.eac.error).toEqual({
    mean: 0.063,
    p99: 0,
    max: 0.5,
    mipsMax: 1,
  });
});

test("a site without a sky view weighs nothing and errs nowhere", () => {
  const none = siteBlocks([]);
  expect(none.tiles).toBe(0);
  expect(none.bc4.error).toEqual({ mean: 0, p99: 0, max: 0, mipsMax: 0 });
});
