import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { writeArrayBuffer } from "geotiff";
import {
  decodeHeightfield,
  parseHeightfieldHeader,
} from "../lib/city/heightfield";
import { dgmSourceFiles, tileBlock } from "../lib/city/tile";
import { DRESDEN } from "../sites/dresden";

const PRIMARY_TILE = tileBlock(DRESDEN)[0].tile;
import { bakeHeightfield } from "./bake-heightfield";

function arrayBufferOf(buf: Buffer<ArrayBuffer>): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test("bakes the committed primary DGM into a heightfield the client decodes", async () => {
  const src = dgmSourceFiles(PRIMARY_TILE);
  const baked = await bakeHeightfield(
    arrayBufferOf(readFileSync(src.tif)),
    readFileSync(src.tfw, "utf8"),
    64
  );
  expect(baked.source).toEqual({ width: 2000, height: 2000 });
  // The header (with the publisher's sibling name added) parses at the
  // current version and frames the 2 km tile.
  const header = parseHeightfieldHeader({ ...baked.header, data: "x.u16.gz" });
  expect(header.n).toBe(64);
  expect(header.bounds[2] - header.bounds[0]).toBe(2000);
  expect(header.bounds[3] - header.bounds[1]).toBe(2000);
  // The grid round-trips: the Elbe crosses this tile, so its lowest valid
  // sample is the river surface (~104 m) — the value the valley-fog floor
  // and the spawn fallback anchor to.
  const samples = decodeHeightfield(
    arrayBufferOf(gunzipSync(baked.data)),
    header
  );
  expect(samples.length).toBe(64 * 64);
  const valid = Array.from(samples).filter((z) => Number.isFinite(z));
  expect(valid.length).toBe(samples.length);
  const min = Math.min(...valid);
  expect(min).toBeGreaterThan(100);
  expect(min).toBeLessThan(110);
});

test("a raster without georeferencing is placed by its .tfw, or refused", async () => {
  // A 4×4 TIFF whose transform is pixel space — what an untagged tile reads
  // as. (geotiff's writer invents a whole-globe transform unless a projection
  // key is given, hence the EPSG tag.)
  const bare = writeArrayBuffer(
    Array.from({ length: 16 }, (_, i) => 100 + i),
    {
      width: 4,
      height: 4,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 0, 4, 0],
      ProjectedCSTypeGeoKey: 25_833,
    }
  );
  // bun-types declare the `rejects` matchers as void, but bun resolves them
  // asynchronously — dropping the await would end the test before it runs.
  // oxlint-disable-next-line typescript/await-thenable
  await expect(bakeHeightfield(bare, null, 4)).rejects.toThrow(/\.tfw/);
  // The world file references the CENTRE of the top-left pixel; the bounds
  // are the pixel edges.
  const baked = await bakeHeightfield(
    bare,
    "1\n0\n0\n-1\n412000.5\n5657999.5\n",
    4
  );
  expect(baked.header.bounds).toEqual([412_000, 5_657_996, 412_004, 5_658_000]);
});
