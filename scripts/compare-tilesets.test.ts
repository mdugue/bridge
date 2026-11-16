import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { packFootprints } from "../lib/city/footprint-pack";
import { packPoints } from "../lib/city/point-pack";
import {
  compareSites,
  multisetDiff,
  readSite,
  report,
  sameSites,
} from "./compare-tilesets";
import { toExtMeshopt } from "./khr-meshopt";
import { createPublisher } from "./publisher";
import { writeMeshGlb } from "./tile-glb";
import type { MeshInput } from "./tile-glb";

const text = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

/** A published site of `files` (logical name → bytes), read back. */
function published(files: Record<string, Uint8Array>) {
  const dir = mkdtempSync(path.join(tmpdir(), "compare-tilesets-"));
  const publisher = createPublisher(dir, { warming: false });
  for (const [name, bytes] of Object.entries(files)) {
    publisher.publish(name, bytes);
  }
  publisher.finish();
  return readSite(dir);
}

async function compare(
  a: Record<string, Uint8Array>,
  b: Record<string, Uint8Array>
) {
  return await compareSites(published(a), published(b));
}

const tree = (x: number, h: number) => ({
  geometry: { coordinates: [x, 5_669_000], type: "Point" },
  properties: { h, s: "osm" },
  type: "Feature",
});
const trees = (features: unknown[]) =>
  text({ attribution: "OSM", features, type: "FeatureCollection" });

test("a site against itself is equal, every file by its hash", async () => {
  const files = { "trees_t.geojson": trees([tree(1, 5), tree(2, 6)]) };
  const site = published(files);
  const result = await compareSites(site, site);
  expect(sameSites(result)).toBe(true);
  expect(result.equalByHash).toBe(1);
});

test("GeoJSON records and keys in another order are the same records", async () => {
  const reordered = text({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { s: "osm", h: 6 },
        geometry: { type: "Point", coordinates: [2, 5_669_000] },
      },
      tree(1, 5),
    ],
    attribution: "OSM",
  });
  const result = await compare(
    { "trees_t.geojson": trees([tree(1, 5), tree(2, 6)]) },
    { "trees_t.geojson": reordered }
  );
  expect(sameSites(result)).toBe(true);
  expect(result.equalByContent).toBe(1);
});

test("a changed property or a moved record is named with its file", async () => {
  const result = await compare(
    {
      "lamps_t.geojson": trees([tree(1, 5)]),
      "trees_t.geojson": trees([tree(1, 5), tree(2, 6)]),
    },
    {
      "lamps_t.geojson": trees([tree(1, 5)]),
      "trees_t.geojson": trees([tree(1, 5), tree(3, 6)]),
    }
  );
  expect([...result.differs.keys()]).toEqual(["trees_t.geojson"]);
  expect(result.differs.get("trees_t.geojson")?.[0]).toContain(
    "features: 1 records only in a, 1 only in b"
  );
  expect(report(result)).toContain("differs: trees_t.geojson");
  const property = await compare(
    { "a.json": text({ rows: [{ h: 1 }], size: 2 }) },
    { "a.json": text({ rows: [{ h: 1 }], size: 3 }) }
  );
  expect(property.differs.get("a.json")).toEqual(["size: 2 → 3"]);
});

/** A site of a trees file and a tileset that names it as it is served. */
function treesAndTileset(features: unknown[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "compare-tilesets-"));
  const publisher = createPublisher(dir, { warming: false });
  const served = publisher.publish("trees_t.geojson", trees(features));
  publisher.publish("tileset.json", text({ root: { uri: served } }));
  publisher.finish();
  return readSite(dir);
}

test("a file that names another by its served name is not itself named", async () => {
  // the tileset names the trees file by its hash, which a moved tree changes
  const result = await compareSites(
    treesAndTileset([tree(1, 5)]),
    treesAndTileset([tree(1.5, 5)])
  );
  expect([...result.differs.keys()]).toEqual(["trees_t.geojson"]);
  expect(result.equalByContent).toBe(1);
});

test("files in one site only are listed", async () => {
  const result = await compare(
    { "a.json": text(1), "b.json": text(2) },
    { "a.json": text(1), "c.json": text(3) }
  );
  expect(result.onlyA).toEqual(["b.json"]);
  expect(result.onlyB).toEqual(["c.json"]);
  expect(sameSites(result)).toBe(false);
});

// --- glb ---------------------------------------------------------------------

const mesh = (dz = 0, baseZ = 100): MeshInput => ({
  name: "city",
  positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, dz, 5, 5, 1, 6, 5, 1]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 2, 3, 4]),
  extras: { kind: "city", tileId: "t" },
  table: {
    className: "building",
    count: 1,
    properties: {
      baseZ: {
        type: "SCALAR",
        componentType: "FLOAT32",
        values: new Float32Array([baseZ]),
      },
    },
  },
  attributes: { _FEATURE_ID_0: new Float32Array([0, 0, 0, 0, 0]) },
});

/** The glb read by gltf-transform and written again, without meshopt:
 *  other bytes, the same content (gltf-transform keeps no property table,
 *  so the mesh has none). */
async function reencoded(glb: Uint8Array): Promise<Uint8Array> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(toExtMeshopt(glb));
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === EXTMeshoptCompression.EXTENSION_NAME) {
      ext.dispose();
    }
  }
  return await io.writeBinary(doc);
}

test("a glb encoded again with the same content is equal", async () => {
  const glb = await writeMeshGlb({ ...mesh(), table: undefined });
  const again = await reencoded(glb);
  expect(Buffer.compare(glb, again)).not.toBe(0);
  const result = await compare(
    { "city_t.glb.gz": gzipSync(glb) },
    { "city_t.glb.gz": gzipSync(again) }
  );
  expect(report(result)).toContain("1 equal by content, 0 differ");
});

test("a glb's moved vertex and its changed property table are named", async () => {
  const result = await compare(
    { "city_t.glb.gz": gzipSync(await writeMeshGlb(mesh())) },
    { "city_t.glb.gz": gzipSync(await writeMeshGlb(mesh(1, 102))) }
  );
  const lines = result.differs.get("city_t.glb.gz") ?? [];
  expect(lines.some((l) => l.startsWith("property table "))).toBe(true);
  expect(lines.some((l) => l.includes("POSITION: 1 values beyond"))).toBe(true);
});

// --- rasters and the packed binaries ------------------------------------------

const grey = async (data: Uint8Array, compressionLevel: number) =>
  await sharp(Buffer.from(data), { raw: { channels: 1, height: 2, width: 2 } })
    .toColourspace("b-w")
    .png({ compressionLevel })
    .toBuffer();

test("a raster compares by its decoded values", async () => {
  const cells = new Uint8Array([1, 2, 3, 4]);
  const same = await compare(
    { "landcover_t.png": await grey(cells, 9) },
    { "landcover_t.png": await grey(cells, 1) }
  );
  expect(sameSites(same)).toBe(true);
  const changed = await compare(
    { "landcover_t.png": await grey(cells, 9) },
    { "landcover_t.png": await grey(new Uint8Array([1, 2, 3, 9]), 9) }
  );
  expect(changed.differs.get("landcover_t.png")).toEqual([
    "1 of 4 values differ, by up to 5 (first at column 1, row 1: 4 → 9)",
  ]);
});

const point = (x: number) => ({ h: 10, x, y: 1 });
const footprint = (x: number) => [
  [
    [x, 0],
    [x + 1, 0],
    [x, 1],
  ] as [number, number][],
];

test("packed points and footprints compare as unordered records", async () => {
  const origin: [number, number] = [392_000, 5_668_000];
  const same = await compare(
    {
      "canopy_t.pts.gz": gzipSync(packPoints([point(1), point(2)], origin, 3)),
      "footprints_t.fpr.gz": gzipSync(
        packFootprints([footprint(1), footprint(5)])
      ),
    },
    {
      "canopy_t.pts.gz": gzipSync(packPoints([point(2), point(1)], origin, 3)),
      "footprints_t.fpr.gz": gzipSync(
        packFootprints([footprint(5), footprint(1)])
      ),
    }
  );
  expect(sameSites(same)).toBe(true);
  expect(same.equalByContent).toBe(2);
  const moved = await compare(
    {
      "canopy_t.pts.gz": gzipSync(packPoints([point(1), point(2)], origin, 3)),
    },
    { "canopy_t.pts.gz": gzipSync(packPoints([point(1), point(3)], origin, 3)) }
  );
  expect(moved.differs.get("canopy_t.pts.gz")?.[0]).toStartWith(
    "1 points only in a, 1 only in b"
  );
});

test("a multiset keeps each copy of a row", () => {
  expect(multisetDiff(["a", "a", "b"], ["a", "b", "c"])).toEqual({
    onlyA: ["a"],
    onlyB: ["c"],
  });
});
