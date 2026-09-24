import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { writeArrayBuffer } from "geotiff";
import { dgmSourceFiles } from "../lib/city/tile";
import { DRESDEN } from "../sites/dresden";
import { readDgm, terrainMesh } from "./bake-tiles";

const PRIMARY_TILE = "33412_5656_2_sn";

function arrayBufferOf(buf: Buffer<ArrayBuffer>): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test("the committed spawn-tile DGM resamples to a grid on the Elbe", async () => {
  const src = dgmSourceFiles(DRESDEN, PRIMARY_TILE);
  const dgm = await readDgm(
    arrayBufferOf(readFileSync(src.tif)),
    readFileSync(src.tfw, "utf8"),
    64
  );
  expect(dgm.bounds[2] - dgm.bounds[0]).toBe(2000);
  expect(dgm.bounds[3] - dgm.bounds[1]).toBe(2000);
  expect(dgm.elevations).toHaveLength(64 * 64);
  // The Elbe crosses this tile: its lowest sample is the river (~104 m).
  const min = Math.min(...dgm.elevations);
  expect(min).toBeGreaterThan(100);
  expect(min).toBeLessThan(110);
  // The mesh: the grid first (row 0 = north, the elevations as z), then the
  // skirt; an interior normal points up.
  const mesh = terrainMesh(dgm, [], { cx: 413_000, cy: 5_657_000 });
  expect(mesh.input.positions.length).toBeGreaterThan(64 * 64 * 3);
  const inner = 32 * 64 + 32;
  expect(mesh.input.positions[inner * 3 + 2]).toBe(dgm.elevations[inner]);
  expect(mesh.minElevation).toBeCloseTo(min, 3);
  expect(mesh.input.normals[inner * 3 + 2]).toBeGreaterThan(0.5);
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
  await expect(readDgm(bare, null, 4)).rejects.toThrow(/\.tfw/);
  // The world file references the CENTRE of the top-left pixel; the bounds
  // are the pixel edges.
  const dgm = await readDgm(bare, "1\n0\n0\n-1\n412000.5\n5657999.5\n", 4);
  expect(dgm.bounds).toEqual([412_000, 5_657_996, 412_004, 5_658_000]);
});
