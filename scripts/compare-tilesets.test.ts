import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { packCrowns } from "../lib/city/coarse-crowns";
import type { CoarseCrown } from "../lib/city/coarse-crowns";
import { packFootprints } from "../lib/city/footprint-pack";
import { encodePlate } from "../lib/city/ground-plate";
import { packPoints } from "../lib/city/point-pack";
import {
  compareSites,
  multisetDiff,
  readSite,
  report,
  sameSites,
} from "./compare-tilesets";
import type { SiteComparison } from "./compare-tilesets";
import { readGlb, writeGlb } from "./glb-container";
import { toExtMeshopt } from "./khr-meshopt";
import { createPublisher } from "./publisher";
import { writeMeshGlb } from "./tile-glb";
import type { MeshInput } from "./tile-glb";

const text = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const fresh = () => mkdtempSync(path.join(tmpdir(), "compare-tilesets-"));

/** A published site of `files` (logical name → bytes): its folder. */
function publishedDir(files: Record<string, Uint8Array>): string {
  const dir = fresh();
  const publisher = createPublisher(dir, { warming: false });
  for (const [name, bytes] of Object.entries(files)) {
    publisher.publish(name, bytes);
  }
  publisher.finish();
  return dir;
}

async function compare(
  a: Record<string, Uint8Array>,
  b: Record<string, Uint8Array>
): Promise<SiteComparison> {
  return await compareSites(
    readSite(publishedDir(a)),
    readSite(publishedDir(b))
  );
}

/** The lines the one differing file `name` gets, and nothing else differs. */
async function onlyDiffers(
  name: string,
  a: Record<string, Uint8Array>,
  b: Record<string, Uint8Array>
): Promise<string[]> {
  const result = await compare(a, b);
  expect([...result.differs.keys()]).toEqual([name]);
  expect(sameSites(result)).toBe(false);
  return result.differs.get(name) ?? [];
}

async function same(
  a: Record<string, Uint8Array>,
  b: Record<string, Uint8Array>
): Promise<SiteComparison> {
  const result = await compare(a, b);
  expect(report(result)).toContain("0 differ");
  expect(sameSites(result)).toBe(true);
  return result;
}

const tree = (x: number, h: number) => ({
  geometry: { coordinates: [x, 5_669_000], type: "Point" },
  properties: { h, s: "osm" },
  type: "Feature",
});
const trees = (features: unknown[]) =>
  text({ attribution: "OSM", features, type: "FeatureCollection" });

// --- the sites ----------------------------------------------------------------

test("a site against itself is equal, every file by its hash", async () => {
  const site = readSite(
    publishedDir({ "trees_t.geojson": trees([tree(1, 5)]) })
  );
  const result = await compareSites(site, site);
  expect(sameSites(result)).toBe(true);
  expect(result.equalByHash).toBe(1);
});

test("a manifest path is the site it names, not its folder", async () => {
  const dir = fresh();
  writeFileSync(path.join(dir, "a.11111111.json"), text({ a: 1 }));
  writeFileSync(path.join(dir, "b.22222222.json"), text({ b: 2 }));
  const manifest = (files: Record<string, string>) =>
    text({ files, version: 1 });
  writeFileSync(
    path.join(dir, "one.json"),
    manifest({ "a.json": "a.11111111.json" })
  );
  writeFileSync(
    path.join(dir, "two.json"),
    manifest({ "b.json": "b.22222222.json" })
  );
  const result = await compareSites(
    readSite(path.join(dir, "one.json")),
    readSite(path.join(dir, "two.json"))
  );
  expect(result.onlyA).toEqual(["a.json"]);
  expect(result.onlyB).toEqual(["b.json"]);
  expect(sameSites(result)).toBe(false);
});

test("a folder without a manifest is an error, not a listing", () => {
  const dir = fresh();
  writeFileSync(path.join(dir, "a.json"), text(1));
  expect(() => readSite(dir)).toThrow("no manifest.json");
});

test("sites that name no file are an error, never the same", async () => {
  const empty = readSite(publishedDir({}));
  await expect(compareSites(empty, empty)).rejects.toThrow("names a file");
  const nothing: SiteComparison = {
    differs: new Map(),
    equalByContent: 0,
    equalByHash: 0,
    onlyA: [],
    onlyB: [],
  };
  expect(sameSites(nothing)).toBe(false);
  expect(
    sameSites({ ...nothing, differs: new Map([["a", ["x"]]]), equalByHash: 1 })
  ).toBe(false);
});

test("a named file missing or changed under the same name differs", async () => {
  const a = readSite(publishedDir({ "a.json": text(1), "b.json": text(2) }));
  // b: the same manifest; a's file not there, b's with other bytes
  const dirB = fresh();
  writeFileSync(
    path.join(dirB, "manifest.json"),
    text({ files: Object.fromEntries(a.files), version: 1 })
  );
  writeFileSync(path.join(dirB, a.files.get("b.json") ?? ""), text(3));
  const result = await compareSites(a, readSite(dirB));
  expect(result.differs.get("a.json")).toEqual(["named but missing in b"]);
  expect(result.differs.get("b.json")).toEqual(["2 → 3"]);
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

// --- JSON -----------------------------------------------------------------------

test("keys in another order are the same document", async () => {
  await same(
    { "a.json": text({ x: 1, y: [1, 2] }) },
    { "a.json": new TextEncoder().encode('{"y":[1,2],"x":1}') }
  );
});

const trams = (patterns: unknown[]) =>
  text({ patterns, profiles: [{ pattern: 0 }] });

test("records in another order differ: rows are read by position", async () => {
  const lines = await onlyDiffers(
    "trams.json",
    { "trams.json": trams([{ id: "a" }, { id: "b" }]) },
    { "trams.json": trams([{ id: "b" }, { id: "a" }]) }
  );
  expect(lines).toEqual(["patterns: the same 2 items in another order"]);
  const features = await onlyDiffers(
    "trees_t.geojson",
    { "trees_t.geojson": trees([tree(1, 5), tree(2, 6)]) },
    { "trees_t.geojson": trees([tree(2, 6), tree(1, 5)]) }
  );
  expect(features).toEqual(["features: the same 2 items in another order"]);
});

test("a changed value is named by its path", async () => {
  const lines = await onlyDiffers(
    "trees_t.geojson",
    { "trees_t.geojson": trees([tree(1, 5), tree(2, 6)]) },
    { "trees_t.geojson": trees([tree(1, 5), tree(3, 6)]) }
  );
  expect(lines).toEqual(["features[1].geometry.coordinates[0]: 2 → 3"]);
});

/** A trees file and a tileset that names it by `uri(served)`. */
function treesAndTileset(features: unknown[], uri: (s: string) => string) {
  const dir = fresh();
  const publisher = createPublisher(dir, { warming: false });
  const served = publisher.publish("trees_t.geojson", trees(features));
  publisher.publish("tileset.json", text({ root: { uri: uri(served) } }));
  publisher.finish();
  return readSite(dir);
}

test("a file that names another by its served name is not itself named", async () => {
  const result = await compareSites(
    treesAndTileset([tree(1, 5)], (s) => s),
    treesAndTileset([tree(1.5, 5)], (s) => s)
  );
  expect([...result.differs.keys()]).toEqual(["trees_t.geojson"]);
  expect(result.equalByContent).toBe(1);
});

test("an unhashed name is not the served file it would resolve to", async () => {
  const result = await compareSites(
    treesAndTileset([tree(1, 5)], (s) => s),
    treesAndTileset([tree(1, 5)], () => "trees_t.geojson")
  );
  expect([...result.differs.keys()]).toEqual(["tileset.json"]);
});

// --- glb ------------------------------------------------------------------------

interface Prim {
  code?: number;
  extras?: Record<string, unknown>;
  index?: number[];
  normalZ?: number;
  roughness?: number;
  w?: number;
  z?: number;
}

/** A glb of one triangle written plainly: float positions, int8 normals,
 *  a snorm16 packed code (`_FACADE`), a float field (`_W`). */
async function glbOf(p: Prim = {}): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (
    array: Float32Array | Int16Array | Int8Array | Uint16Array,
    type: "SCALAR" | "VEC3"
  ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      acc(new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, p.z ?? 0]), "VEC3")
    )
    .setAttribute(
      "NORMAL",
      acc(
        new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, p.normalZ ?? 127]),
        "VEC3"
      ).setNormalized(true)
    )
    .setAttribute(
      "_FACADE",
      acc(new Int16Array([0, 1, p.code ?? 2]), "SCALAR").setNormalized(true)
    )
    .setAttribute("_W", acc(new Float32Array([0, 1, p.w ?? 2]), "SCALAR"))
    .setIndices(acc(new Uint16Array(p.index ?? [0, 1, 2]), "SCALAR"))
    .setMaterial(
      doc.createMaterial("clay").setRoughnessFactor(p.roughness ?? 0.5)
    );
  const node = doc
    .createNode("city")
    .setMesh(doc.createMesh("city").addPrimitive(prim))
    .setExtras(p.extras ?? { kind: "city", tileId: "t" });
  doc.createScene().addChild(node);
  return await new NodeIO().writeBinary(doc);
}

interface EditableGltf {
  extensions: {
    EXT_structural_metadata: {
      schema: { classes: Record<string, { description?: string }> };
    };
  };
  extras?: unknown;
  meshes: { primitives: { extensions?: unknown }[] }[];
}

/** The glb with its JSON chunk changed by `edit`. */
function patched(glb: Uint8Array, edit: (json: EditableGltf) => void) {
  const { json, bin } = readGlb<EditableGltf>(glb);
  edit(json);
  return writeGlb(json, [bin]);
}

const glbFile = async (glb: Uint8Array) => ({
  "city_t.glb.gz": gzipSync(glb),
});

async function glbLines(a: Uint8Array, b: Uint8Array): Promise<string[]> {
  return await onlyDiffers("city_t.glb.gz", await glbFile(a), await glbFile(b));
}

test("a glb compared with itself, written again, is equal", async () => {
  await same(await glbFile(await glbOf()), await glbFile(await glbOf()));
});

test("a packed code one step apart differs: only measurements are tolerant", async () => {
  const lines = await glbLines(await glbOf(), await glbOf({ code: 3 }));
  expect(lines).toEqual([
    "city/city#0 _FACADE: 1 values differ (vertex 2: (0.0001) → (0.0001))",
  ]);
});

test("a normal one quantisation step apart is the same normal", async () => {
  await same(
    await glbFile(await glbOf()),
    await glbFile(await glbOf({ normalZ: 126 }))
  );
});

test("NaN is equal only to NaN", async () => {
  const lines = await glbLines(await glbOf(), await glbOf({ w: Number.NaN }));
  expect(lines[0]).toStartWith("city/city#0 _W: 1 values differ");
  await same(
    await glbFile(await glbOf({ w: Number.NaN })),
    await glbFile(await glbOf({ w: Number.NaN }))
  );
});

test("a glb's moved vertex, indices, extras, material differ", async () => {
  expect(await glbLines(await glbOf(), await glbOf({ z: 0.01 }))).toEqual([
    "city/city#0 POSITION: 1 values differ (vertex 2: (0, 4, 0) → (0, 4, 0.01))",
  ]);
  expect(
    await glbLines(await glbOf(), await glbOf({ index: [0, 2, 1] }))
  ).toEqual(["city/city#0 indices: 2 differ"]);
  expect(
    await glbLines(
      await glbOf(),
      await glbOf({ extras: { kind: "x", tileId: "t" } })
    )
  ).toEqual(["nodes[0].extras.kind: city → x"]);
  expect(
    await glbLines(await glbOf(), await glbOf({ roughness: 0.25 }))
  ).toEqual(["materials[0].pbrMetallicRoughness.roughnessFactor: 0.5 → 0.25"]);
});

test("a member nobody named is compared: a primitive's extension, the root's extras", async () => {
  const glb = await glbOf();
  const featured = (count: number) =>
    patched(glb, (json) => {
      json.meshes[0].primitives[0].extensions = {
        EXT_mesh_features: {
          featureIds: [{ attribute: 0, featureCount: count }],
        },
      };
    });
  expect(await glbLines(featured(1), featured(2))).toEqual([
    "meshes[0].primitives[0].extensions.EXT_mesh_features.featureIds[0].featureCount: 1 → 2",
  ]);
  const rooted = patched(glb, (json) => {
    json.extras = { site: "x" };
  });
  expect(await glbLines(glb, rooted)).toEqual(["extras: only in b"]);
});

// The tile glbs as the build writes them: meshopt, quantised, a table.
const mesh = (dz = 0, baseZ = 100, table = true): MeshInput => ({
  name: "city",
  positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 4, dz, 5, 5, 1, 6, 5, 1]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 2, 3, 4]),
  extras: { kind: "city", tileId: "t" },
  table: table
    ? {
        className: "building",
        count: 1,
        properties: {
          baseZ: {
            type: "SCALAR",
            componentType: "FLOAT32",
            values: new Float32Array([baseZ]),
          },
        },
      }
    : undefined,
  attributes: { _FEATURE_ID_0: new Float32Array([0, 0, 0, 0, 0]) },
});

/** The glb read by gltf-transform and written again without meshopt:
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

test("a tile glb encoded again with the same content is equal", async () => {
  const glb = await writeMeshGlb(mesh(0, 100, false));
  const again = await reencoded(glb);
  expect(Buffer.compare(glb, again)).not.toBe(0);
  const result = await same(await glbFile(glb), await glbFile(again));
  expect(result.equalByContent).toBe(1);
});

test("a tile glb's property table is compared row by row", async () => {
  const lines = await glbLines(
    await writeMeshGlb(mesh()),
    await writeMeshGlb(mesh(0, 102))
  );
  expect(lines).toEqual(["property table [0].baseZ[0]: 100 → 102"]);
});

test("a quantised position three steps off differs", async () => {
  // 3 m extent over snorm16: a step is 3 / 32 767 m ≈ 0.09 mm
  const lines = await glbLines(
    await writeMeshGlb(mesh()),
    await writeMeshGlb(mesh(0.0003))
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("POSITION: 1 values beyond the quantisation step");
});

test("a tile glb's metadata schema is compared, not only its values", async () => {
  const glb = await writeMeshGlb(mesh());
  const described = patched(glb, (json) => {
    json.extensions.EXT_structural_metadata.schema.classes.building.description =
      "a building";
  });
  expect(await glbLines(glb, described)).toEqual([
    "extensions.EXT_structural_metadata.schema.classes.building.description: only in b",
  ]);
});

test("a glb with a table against one without is a report, not an error", async () => {
  const lines = await glbLines(
    await writeMeshGlb(mesh()),
    await writeMeshGlb(mesh(0, 100, false))
  );
  expect(lines.some((l) => l.includes("only in a"))).toBe(true);
  expect(lines.some((l) => l.startsWith("cannot be read"))).toBe(false);
});

// --- rasters ----------------------------------------------------------------------

const grey = async (data: Uint8Array, compressionLevel: number) =>
  await sharp(Buffer.from(data), { raw: { channels: 1, height: 2, width: 2 } })
    .toColourspace("b-w")
    .png({ compressionLevel })
    .toBuffer();

const webp = async (data: Uint8Array, effort: number) =>
  await sharp(Buffer.from(data), { raw: { channels: 3, height: 1, width: 2 } })
    .webp({ effort, lossless: true })
    .toBuffer();

test("a PNG compares by its decoded values", async () => {
  const cells = new Uint8Array([1, 2, 3, 4]);
  await same(
    { "landcover_t.png": await grey(cells, 9) },
    { "landcover_t.png": await grey(cells, 1) }
  );
  const lines = await onlyDiffers(
    "landcover_t.png",
    { "landcover_t.png": await grey(cells, 9) },
    { "landcover_t.png": await grey(new Uint8Array([1, 2, 3, 9]), 9) }
  );
  expect(lines).toEqual([
    "1 of 4 values differ, by up to 5 (first at column 1, row 1: 4 → 9)",
  ]);
});

test("a WebP compares by its decoded values", async () => {
  const pixels = new Uint8Array([10, 20, 30, 40, 50, 60]);
  await same(
    { "minimap.webp": await webp(pixels, 6) },
    { "minimap.webp": await webp(pixels, 0) }
  );
  const lines = await onlyDiffers(
    "minimap.webp",
    { "minimap.webp": await webp(pixels, 6) },
    { "minimap.webp": await webp(new Uint8Array([10, 20, 30, 40, 50, 61]), 6) }
  );
  expect(lines[0]).toStartWith("1 of 6 values differ");
});

// --- the packed binaries ------------------------------------------------------------

const origin: [number, number] = [392_000, 5_668_000];
const point = (x: number) => ({ h: 10, x, y: 1 });
const pts = (xs: number[]) => ({
  "canopy_t.pts.gz": gzipSync(packPoints(xs.map(point), origin, 3)),
});

test("canopy points: a moved point, or the same in another order, differ", async () => {
  const [first] = await onlyDiffers(
    "canopy_t.pts.gz",
    pts([1, 2]),
    pts([1, 3])
  );
  expect(first).toStartWith("1 points only in a, 1 only in b");
  expect(
    await onlyDiffers("canopy_t.pts.gz", pts([1, 2]), pts([2, 1]))
  ).toEqual(["the same 2 points in another order"]);
});

const crown = (x: number): CoarseCrown => ({
  kind: "canopy",
  rot: 0,
  s: 1,
  x,
  z: 2,
});
const crw = (xs: number[]) => ({
  "crowns_t.crw.gz": gzipSync(packCrowns(xs.map(crown))),
});

test("coarse crowns: a moved crown differs, the same crowns are equal", async () => {
  await same(crw([1, 2]), crw([1, 2]));
  const [first] = await onlyDiffers(
    "crowns_t.crw.gz",
    crw([1, 2]),
    crw([1, 5])
  );
  expect(first).toStartWith("1 crowns only in a, 1 only in b");
});

const footprint = (x: number) => [
  [
    [x, 0],
    [x + 1, 0],
    [x, 1],
  ] as [number, number][],
];
const fpr = (xs: number[]) => ({
  "footprints_t.fpr.gz": gzipSync(packFootprints(xs.map(footprint))),
});

test("footprints: a moved ring, or another order, differ", async () => {
  const [first] = await onlyDiffers(
    "footprints_t.fpr.gz",
    fpr([1, 5]),
    fpr([1, 6])
  );
  expect(first).toStartWith("1 footprints only in a, 1 only in b");
  expect(
    await onlyDiffers("footprints_t.fpr.gz", fpr([1, 5]), fpr([5, 1]))
  ).toEqual(["the same 2 footprints in another order"]);
});

/** A site of a one-tile plate (n = 2) and the tileset that names it. */
function plateSite(heights: number[]): Record<string, Uint8Array> {
  return {
    "plate.bin.gz": gzipSync(
      encodePlate(
        [{ classes: new Uint8Array(4), heights: Int16Array.from(heights) }],
        2
      )
    ),
    "tileset.json": text({
      extras: {
        plate: {
          file: "plate.bin.gz",
          n: 2,
          tiles: [{ bounds: [0, 0, 2000, 2000], id: "t" }],
        },
      },
    }),
  };
}

test("the plate: a changed height differs, read through the tileset", async () => {
  const lines = await onlyDiffers(
    "plate.bin.gz",
    plateSite([1, 2, 3, 4]),
    plateSite([1, 2, 3, 5])
  );
  expect(lines[0]).toStartWith("1 tiles only in a, 1 only in b");
});

test("a kind without a reader compares as bytes", async () => {
  const lines = await onlyDiffers(
    "data.bin",
    { "data.bin": new Uint8Array([1, 2]) },
    { "data.bin": new Uint8Array([1, 3]) }
  );
  expect(lines).toEqual(["bytes differ (2 in a, 2 in b)"]);
});

test("a file its reader refuses differs, with the reason", async () => {
  const lines = await onlyDiffers(
    "a.json",
    { "a.json": text(1) },
    { "a.json": new TextEncoder().encode("{not json") }
  );
  expect(lines[0]).toStartWith("cannot be read as its kind");
});

// --- the command ----------------------------------------------------------------------

function run(...args: string[]): number {
  const script = path.join(import.meta.dir, "compare-tilesets.ts");
  return Bun.spawnSync(["bun", script, ...args], {
    stderr: "ignore",
    stdout: "ignore",
  }).exitCode;
}

test("the command exits 0 when the same, 1 on a difference, 2 when it cannot read", () => {
  const a = publishedDir({ "a.json": text(1) });
  const b = publishedDir({ "a.json": text(2) });
  expect(run(a, a)).toBe(0);
  expect(run(a, b)).toBe(1);
  expect(run(a, fresh())).toBe(2);
  expect(run(a)).toBe(2);
});

test("a multiset keeps each copy of a row", () => {
  expect(multisetDiff(["a", "a", "b"], ["a", "b", "c"])).toEqual({
    onlyA: ["a"],
    onlyB: ["c"],
  });
});
