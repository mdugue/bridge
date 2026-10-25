import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArrayBuffer } from "geotiff";
import { readDgm } from "./bake-tiles";
import { dgmCacheDir, packDgm, readDgmFile, unpackDgm } from "./dgm-cache";

const TFW = "1\n0\n0\n-1\n412000.5\n5657999.5\n";

/** A 4×4 DGM whose samples count up from `base`. */
function tiff(base: number): Uint8Array {
  return new Uint8Array(
    writeArrayBuffer(
      Array.from({ length: 16 }, (_, i) => base + i),
      {
        width: 4,
        height: 4,
        ModelPixelScale: [1, 1, 0],
        ModelTiepoint: [0, 0, 0, 0, 4, 0],
        ProjectedCSTypeGeoKey: 25_833,
      }
    )
  );
}

test("a cached decode reads back as readDgm decodes the bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dgm-cache-"));
  const tif = join(dir, "dgm1_t.tif");
  const tfw = join(dir, "dgm1_t.tfw");
  writeFileSync(tif, tiff(100));
  writeFileSync(tfw, TFW);
  const cache = join(dir, "cache");
  const bytes = tiff(100);
  const direct = await readDgm(bytes.slice().buffer, TFW, "native");
  const cold = await readDgmFile(tif, tfw, "native", cache);
  expect(readdirSync(cache)).toHaveLength(1);
  const warm = await readDgmFile(tif, tfw, "native", cache);
  for (const dgm of [cold, warm]) {
    expect(dgm.n).toBe(direct.n);
    expect(dgm.bounds).toEqual(direct.bounds);
    expect(Array.from(dgm.elevations)).toEqual(Array.from(direct.elevations));
  }
  // The warm read is the entry's, not a second decode.
  const [kept] = readdirSync(cache);
  writeFileSync(
    join(cache, kept),
    packDgm({ ...direct, elevations: new Float32Array(16).fill(7) })
  );
  expect((await readDgmFile(tif, tfw, "native", cache)).elevations[0]).toBe(7);
  // New bytes are a new key: the stale entry goes, the new decode is read.
  writeFileSync(tif, tiff(200));
  const changed = await readDgmFile(tif, tfw, "native", cache);
  expect(changed.elevations[0]).toBe(200);
  expect(readdirSync(cache)).toHaveLength(1);
  // A truncated entry is no entry: the TIFF is decoded again.
  const [entry] = readdirSync(cache);
  writeFileSync(join(cache, entry), new Uint8Array(12));
  expect((await readDgmFile(tif, tfw, "native", cache)).elevations[0]).toBe(
    200
  );
});

test("an entry's bytes hold the whole DGM, and nothing short of one", () => {
  const dgm = {
    bounds: [412_000, 5_657_996, 412_004, 5_658_000] as [
      number,
      number,
      number,
      number,
    ],
    elevations: Float32Array.from([1.5, Number.NaN, -3, 1e6]),
    n: 2,
  };
  const packed = packDgm(dgm);
  const back = unpackDgm(packed);
  expect(back?.n).toBe(2);
  expect(back?.bounds).toEqual(dgm.bounds);
  expect(Array.from(back?.elevations ?? [])).toEqual(
    Array.from(dgm.elevations)
  );
  expect(unpackDgm(packed.subarray(0, packed.byteLength - 4))).toBeNull();
});

test("the cache is on under bun test or DGM_CACHE=1, never in the build", () => {
  expect(dgmCacheDir({ NODE_ENV: "test" })).toEndWith(join(".cache", "dgm"));
  expect(dgmCacheDir({ DGM_CACHE: "1" })).not.toBeNull();
  expect(dgmCacheDir({ NODE_ENV: "production" })).toBeNull();
});
