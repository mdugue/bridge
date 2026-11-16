import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Document, NodeIO } from "@gltf-transform/core";
import type {
  Accessor,
  Node as GltfNode,
  Primitive,
} from "@gltf-transform/core";
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
import type { SiteComparison, Tolerance } from "./compare-tilesets";
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
  b: Record<string, Uint8Array>,
  tolerance: Tolerance = {}
): Promise<SiteComparison> {
  return await compareSites(
    readSite(publishedDir(a)),
    readSite(publishedDir(b)),
    tolerance
  );
}

/** The lines the one differing file `name` gets, and nothing else differs. */
async function onlyDiffers(
  name: string,
  a: Record<string, Uint8Array>,
  b: Record<string, Uint8Array>,
  tolerance: Tolerance = {}
): Promise<string[]> {
  const result = await compare(a, b, tolerance);
  expect(result.unreadable.size).toBe(0);
  expect([...result.differs.keys()]).toEqual([name]);
  expect(sameSites(result)).toBe(false);
  return result.differs.get(name) ?? [];
}

async function same(
  a: Record<string, Uint8Array>,
  b: Record<string, Uint8Array>,
  tolerance: Tolerance = {}
): Promise<SiteComparison> {
  const result = await compare(a, b, tolerance);
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
  // the folder's other files are not that manifest's site
  expect([...readSite(path.join(dir, "one.json")).files.keys()]).toEqual([
    "a.json",
  ]);
});

/** A site with a dated file beside its manifest holding `n`. */
function withStats(n: number) {
  const dir = publishedDir({ "a.json": text(1) });
  writeFileSync(path.join(dir, "site-stats.20261116.json"), text(n));
  return readSite(dir);
}

test("a stray file named like a logical name never stands in for it", async () => {
  const a = publishedDir({ "tileset.json": text({ x: 1 }) });
  const b = publishedDir({ "tileset.json": text({ x: 2 }) });
  writeFileSync(path.join(b, "tileset.json"), text({ x: 1 }));
  const result = await compareSites(readSite(a), readSite(b));
  expect(result.differs.get("tileset.json")).toEqual(["x: 1 → 2"]);
});

test("a folder's site is its manifest and every file beside it", async () => {
  const result = await compareSites(withStats(1), withStats(2));
  expect(result.differs.get("site-stats.20261116.json")).toEqual(["1 → 2"]);
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
    deviation: { position: 0, unit: 0 },
    differs: new Map(),
    equalByContent: 0,
    equalByHash: 0,
    onlyA: [],
    onlyB: [],
    tolerance: {},
    unreadable: new Map(),
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
  // named by both, on neither disk
  const both = await compareSites(readSite(dirB), readSite(dirB));
  expect(both.differs.get("a.json")).toEqual(["named but missing in a and b"]);
  expect(sameSites(both)).toBe(false);
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

const proto = (n: number) => new TextEncoder().encode(`{"__proto__":${n}}`);

test("a member named __proto__ is an ordinary member", async () => {
  expect(
    await onlyDiffers("a.json", { "a.json": proto(1) }, { "a.json": proto(2) })
  ).toEqual(["__proto__: 1 → 2"]);
});

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

/** What a test may add to the plain glb before it is written. */
interface Parts {
  acc: (array: Stored, type: "SCALAR" | "VEC3" | "VEC4") => Accessor;
  doc: Document;
  node: GltfNode;
  prim: Primitive;
}

interface Prim {
  code?: number;
  /** a last change to the document before it is written */
  more?: (parts: Parts) => void;
  extras?: Record<string, unknown>;
  /** metres a stored position step is worth (positions as snorm16) */
  grid?: number;
  index?: number[];
  /** the node mirrored (scale z −1), the positions mirrored back */
  mirror?: boolean;
  normalZ?: number;
  /** a node in no scene, its triangle's last z */
  orphan?: number;
  roughness?: number;
  /** a morph target's last z */
  target?: number;
  /** the node turned 180° about X, the positions turned back */
  turn?: boolean;
  w?: number;
  /** the triangle's last vertex z (m) */
  z?: number;
}

type Stored =
  | Float32Array<ArrayBuffer>
  | Int16Array<ArrayBuffer>
  | Int8Array<ArrayBuffer>
  | Uint16Array<ArrayBuffer>;

/** The triangle's positions as the prim asks: float, or snorm16 steps. */
function positions(p: Prim): { array: Stored; scale: number } {
  const z = p.z ?? 0;
  const flip = p.turn ? -1 : 1;
  const xyz = [0, 0, 0, 4, 0, 0, 0, 4 * flip, (p.mirror ? -1 : 1) * flip * z];
  if (p.grid === undefined) {
    return { array: new Float32Array(xyz), scale: 1 };
  }
  const { grid } = p;
  return {
    array: Int16Array.from(xyz, (v) => Math.round(v / grid)),
    scale: grid * 32_767,
  };
}

/** A glb of one triangle written plainly: float (or snorm16) positions,
 *  int8 normals, a snorm16 packed code (`_FACADE`), a float field (`_W`). */
async function glbOf(p: Prim = {}): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (array: Stored, type: "SCALAR" | "VEC3" | "VEC4") =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const { array, scale } = positions(p);
  const position = acc(array, "VEC3").setNormalized(p.grid !== undefined);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
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
  if (p.target !== undefined) {
    prim.addTarget(
      doc
        .createPrimitiveTarget()
        .setAttribute(
          "POSITION",
          acc(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, p.target]), "VEC3")
        )
    );
  }
  const node = doc
    .createNode("city")
    .setMesh(doc.createMesh("city").addPrimitive(prim))
    .setScale([scale, scale, p.mirror ? -scale : scale])
    .setExtras(p.extras ?? { kind: "city", tileId: "t" });
  if (p.turn) {
    node.setRotation([1, 0, 0, 0]);
  }
  doc.createScene().addChild(node);
  if (p.orphan !== undefined) {
    const lost = doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        acc(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, p.orphan]), "VEC3")
      );
    doc.createNode("lost").setMesh(doc.createMesh("lost").addPrimitive(lost));
  }
  p.more?.({ acc, doc, node, prim });
  return await new NodeIO().writeBinary(doc);
}

interface EditableGltf {
  accessors: { max?: number[]; name?: string }[];
  extensions: {
    EXT_structural_metadata: {
      schema: { classes: Record<string, { description?: string }> };
    };
  };
  extras?: unknown;
  meshes: { primitives: { extensions?: unknown; material?: number }[] }[];
  materials: unknown[];
  nodes: { extensions?: unknown }[];
}

/** The glb with its JSON chunk changed by `edit`. */
function patched(glb: Uint8Array, edit: (json: EditableGltf) => void) {
  const { json, bin } = readGlb<EditableGltf>(glb);
  edit(json);
  return writeGlb(json, [bin]);
}

const glbFile = (glb: Uint8Array) => ({ "city_t.glb.gz": gzipSync(glb) });

async function glbLines(
  a: Uint8Array,
  b: Uint8Array,
  tolerance: Tolerance = {}
): Promise<string[]> {
  return await onlyDiffers("city_t.glb.gz", glbFile(a), glbFile(b), tolerance);
}

test("a glb compared with itself, written again, is equal", async () => {
  await same(glbFile(await glbOf()), glbFile(await glbOf()));
});

test("a packed code one step apart differs", async () => {
  const lines = await glbLines(await glbOf(), await glbOf({ code: 3 }));
  expect(lines).toEqual([
    "mesh 0#0 _FACADE: 1 values differ (first at 2: 2 → 3)",
  ]);
});

test("a normal one step apart differs, unless a unit tolerance is asked for", async () => {
  const [a, b] = [await glbOf(), await glbOf({ normalZ: 126 })];
  expect(await glbLines(a, b)).toEqual([
    "mesh 0#0 NORMAL: 1 values differ (first at 8: 127 → 126)",
  ]);
  const result = await same(glbFile(a), glbFile(b), { withinUnit: 0.01 });
  expect(report(result)).toContain(
    "within 0.01 for unit vectors (largest 0.00787)"
  );
});

test("NaN is equal only to NaN, exact or placed", async () => {
  const lines = await glbLines(await glbOf(), await glbOf({ w: Number.NaN }));
  expect(lines[0]).toStartWith("mesh 0#0 _W: 1 values differ");
  await same(
    glbFile(await glbOf({ w: Number.NaN })),
    glbFile(await glbOf({ w: Number.NaN }))
  );
  const within = { within: 1 };
  const placed = await glbLines(
    await glbOf(),
    await glbOf({ z: Number.NaN }),
    within
  );
  expect(placed[0]).toStartWith("node 0#0 POSITION: 1 vertices beyond 1");
  await same(
    glbFile(await glbOf({ z: Number.NaN })),
    glbFile(await glbOf({ z: Number.NaN })),
    within
  );
});

test("a glb's moved vertex, indices, extras, material differ", async () => {
  const moved = await glbLines(await glbOf(), await glbOf({ z: 0.01 }));
  expect(
    moved.some((l) => l.startsWith("mesh 0#0 POSITION: 1 values differ"))
  ).toBe(true);
  expect(
    await glbLines(await glbOf(), await glbOf({ index: [0, 2, 1] }))
  ).toEqual(["mesh 0#0 indices: 2 values differ (first at 1: 1 → 2)"]);
  const longer = await glbLines(
    await glbOf(),
    await glbOf({ index: [0, 1, 2, 0, 2, 1] })
  );
  expect(longer).toContain("mesh 0#0 indices: 3 values in a, 6 in b");
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

test("a member nobody named is compared: extensions, material index, root extras", async () => {
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
  const secondMaterial = patched(glb, (json) => {
    json.materials.push(json.materials[0]);
  });
  const usesSecond = patched(secondMaterial, (json) => {
    json.meshes[0].primitives[0].material = 1;
  });
  expect(await glbLines(secondMaterial, usesSecond)).toEqual([
    "meshes[0].primitives[0].material: 0 → 1",
  ]);
  const extended = patched(glb, (json) => {
    json.nodes[0].extensions = { EXT_mesh_gpu_instancing: { attributes: {} } };
  });
  expect(await glbLines(glb, extended)).toEqual([
    "nodes[0].extensions: only in b",
  ]);
});

/** The triangle's positions replaced (float). */
const placedAt =
  (xyz: number[], lift = 0): Prim["more"] =>
  ({ acc, node, prim }) => {
    prim.setAttribute("POSITION", acc(new Float32Array(xyz), "VEC3"));
    node.setTranslation([0, lift, 0]);
  };

const TRIANGLE = [0, 0, 0, 4, 0, 0, 0, 4, 0];

const animated = async (z: number) =>
  await glbOf({
    more: ({ acc, doc, node }) => {
      const sampler = doc
        .createAnimationSampler()
        .setInput(acc(new Float32Array([0, 1]), "SCALAR"))
        .setOutput(acc(new Float32Array([0, 0, 0, 0, 0, z]), "VEC3"));
      doc
        .createAnimation("rise")
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(node)
            .setTargetPath("translation")
            .setSampler(sampler)
        );
    },
  });

test("accessors no primitive reads are compared: an animation's output", async () => {
  const lines = await glbLines(await animated(1), await animated(1000));
  expect(lines.some((l) => /^accessor \d+: 1 values differ/u.test(l))).toBe(
    true
  );
  // the same values, stored under another name: its storage differs
  const glb = await animated(1);
  const renamed = patched(glb, (json) => {
    const last = json.accessors.at(-1);
    if (last) {
      last.name = "rise";
    }
  });
  const [line] = await glbLines(glb, renamed);
  expect(line).toMatch(/^accessors\.\d+\.name: only in b$/u);
});

test("within a tolerance: the distance is Euclidean, over each vertex", async () => {
  // 4 mm on each axis: 6.9 mm apart
  const a = await glbOf({ more: placedAt(TRIANGLE) });
  const b = await glbOf({
    more: placedAt([0, 0, 0, 4, 0, 0, 0.004, 4.004, 0.004]),
  });
  const [line] = await glbLines(a, b, { within: 0.005 });
  expect(line).toStartWith("node 0#0 POSITION: 1 vertices beyond 0.005");
});

test("within a tolerance: the node's translation places the vertices", async () => {
  // b lifts its node 2 m and its positions 2 m down: the same world
  const a = await glbOf({ more: placedAt(TRIANGLE) });
  const b = await glbOf({
    more: placedAt([0, -2, 0, 4, -2, 0, 0, 2, 0], 2),
  });
  await same(glbFile(a), glbFile(b), { within: 0.001 });
  const lifted = await glbOf({ more: placedAt(TRIANGLE, 2) });
  const [line] = await glbLines(a, lifted, { within: 0.001 });
  expect(line).toStartWith("node 0#0 POSITION: 3 vertices beyond 0.001");
});

test("within a tolerance: every other value is still exact", async () => {
  const lines = await glbLines(await glbOf(), await glbOf({ code: 3 }), {
    within: 1,
    withinUnit: 1,
  });
  expect(lines).toEqual([
    "mesh 0#0 _FACADE: 1 values differ (first at 2: 2 → 3)",
  ]);
});

test("within a tolerance: NaN per component, a tangent's handedness, a normal's length", async () => {
  const placed = { within: 0.01, withinUnit: 0.01 };
  const nan = async (y: number) =>
    await glbOf({ more: placedAt([Number.NaN, y, 0, 4, 0, 0, 0, 4, 0]) });
  const [nanLine] = await glbLines(await nan(0), await nan(1000), placed);
  expect(nanLine).toStartWith("node 0#0 POSITION: 1 vertices beyond 0.01");
  const tangent = async (w: number) =>
    await glbOf({
      more: ({ acc, prim }) => {
        prim.setAttribute(
          "TANGENT",
          acc(new Float32Array([1, 0, 0, w, 1, 0, 0, w, 1, 0, 0, w]), "VEC4")
        );
      },
    });
  expect(await glbLines(await tangent(1), await tangent(-1), placed)).toEqual([
    "node 0#0 TANGENT.w: 3 values differ (first at 0: 1 → -1)",
  ]);
  const short = await glbLines(
    await glbOf(),
    await glbOf({ normalZ: 64 }),
    placed
  );
  expect(short).toEqual([
    "node 0#0 NORMAL length: 1 vertices beyond 0.01 (vertex 2: (1) → (0.5039))",
  ]);
});

const unused = async (z: number) =>
  await glbOf({
    more: ({ acc, doc }) => {
      doc
        .createMesh("spare")
        .addPrimitive(
          doc
            .createPrimitive()
            .setAttribute(
              "POSITION",
              acc(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, z]), "VEC3")
            )
        );
    },
  });

test("within a tolerance: a mesh no node draws is compared exactly", async () => {
  const lines = await glbLines(await unused(0), await unused(1000), {
    within: 0.01,
  });
  expect(
    lines.some((l) => l.startsWith("mesh 1#0 POSITION: 1 values differ"))
  ).toBe(true);
});

test("one quantisation step off on the same grid differs", async () => {
  const lines = await glbLines(
    await glbOf({ grid: 0.001, z: 0.01 }),
    await glbOf({ grid: 0.001, z: 0.011 })
  );
  expect(lines).toEqual([
    "meshes[0].primitives[0].attributes.POSITION.max[2]: 10 → 11",
    "mesh 0#0 POSITION: 1 values differ (first at 8: 10 → 11)",
  ]);
});

test("another quantisation differs; a tolerance is the caller's, with the largest deviation", async () => {
  // 1 mm against 1 cm steps, the last vertex 9 mm apart
  const [fine, coarse] = [
    await glbOf({ grid: 0.001, z: 0.009 }),
    await glbOf({ grid: 0.01, z: 0 }),
  ];
  const exact = await glbLines(fine, coarse);
  expect(
    exact.some((l) =>
      l.startsWith("meshes[0].primitives[0].attributes.POSITION")
    )
  ).toBe(true);
  expect(exact.some((l) => l.startsWith("nodes[0].scale"))).toBe(true);
  expect(await glbLines(fine, coarse, { within: 0.005 })).toEqual([
    "node 0#0 POSITION: 1 vertices beyond 0.005 (vertex 2: (0, 4, 0.009) → (0, 4, 0))",
  ]);
  const result = await same(glbFile(fine), glbFile(coarse), { within: 0.01 });
  expect(report(result)).toContain(
    "compared within 0.01 m (largest 0.00900 m)"
  );
});

test("an accessor's min or max is its storage, compared", async () => {
  const glb = await glbOf();
  const wider = patched(glb, (json) => {
    json.accessors[0].max = [0.5, 0.5, 0.5];
  });
  const [first] = await glbLines(glb, wider);
  expect(first).toStartWith("meshes[0].primitives[0].attributes.POSITION.max");
});

test("a node turned or mirrored with its positions turned back differs", async () => {
  const [plain, turned, mirrored] = [
    await glbOf({ z: 1 }),
    await glbOf({ turn: true, z: 1 }),
    await glbOf({ mirror: true, z: 1 }),
  ];
  const exact = await glbLines(plain, turned);
  expect(exact.some((l) => l.startsWith("nodes[0].rotation"))).toBe(true);
  const placed = { within: 0.001, withinUnit: 0.001 };
  expect(await glbLines(plain, turned, placed)).toEqual([
    "node 0#0 NORMAL: 3 vertices beyond 0.001 (vertex 0: (0, 0, 1) → (0, 0, -1))",
  ]);
  const flipped = await glbLines(plain, mirrored, placed);
  expect(flipped[0]).toBe("node 0#0: the winding turns over");
});

/** A triangle in the plane y + z = 0 (normal (0, 1, 1)/√2), as stored by
 *  a node that stretches y by `stretch`: positions and normal stored so
 *  that the world sees the same triangle. */
async function slanted(stretch: number): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const y = 1 / stretch;
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, y, -1]))
        .setBuffer(buffer)
    )
    .setAttribute(
      "NORMAL",
      // the stored normal the stretch's inverse transpose turns into the
      // world's (0, 1, 1)/√2: (0, stretch, 1) normalised
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(
          Float32Array.from(
            { length: 9 },
            (_, i) => [0, stretch, 1][i % 3] / Math.hypot(stretch, 1)
          )
        )
        .setBuffer(buffer)
    );
  const node = doc
    .createNode("city")
    .setMesh(doc.createMesh("city").addPrimitive(prim))
    .setScale([1, stretch, 1]);
  doc.createScene().addChild(node);
  return await new NodeIO().writeBinary(doc);
}

test("normals are placed by the inverse transpose: a stretched node's same plane is equal", async () => {
  const placed = { within: 1e-6, withinUnit: 1e-6 };
  const result = await same(
    glbFile(await slanted(1)),
    glbFile(await slanted(2)),
    placed
  );
  expect(result.equalByContent).toBe(1);
});

test("morph targets and a node in no scene are compared", async () => {
  expect(
    await glbLines(await glbOf({ target: 1 }), await glbOf({ target: 2 }))
  ).toEqual([
    "meshes[0].primitives[0].targets[0].POSITION.max[2]: 1 → 2",
    "mesh 0#0 target0.POSITION: 1 values differ (first at 8: 1 → 2)",
  ]);
  expect(
    await glbLines(await glbOf({ orphan: 1 }), await glbOf({ orphan: 2 }))
  ).toEqual([
    "meshes[1].primitives[0].attributes.POSITION.max[2]: 1 → 2",
    "mesh 1#0 POSITION: 1 values differ (first at 8: 1 → 2)",
  ]);
  expect(
    await glbLines(await glbOf({ orphan: 1 }), await glbOf({ orphan: 2 }), {
      within: 0.5,
    })
  ).toEqual([
    "node 1#0 POSITION: 1 vertices beyond 0.5 (vertex 2: (0, 1, 1) → (0, 1, 2))",
  ]);
});

test("a glb both sides hold, that cannot be read, is unreadable", async () => {
  const broken = { "city_t.glb.gz": gzipSync(new Uint8Array([1, 2, 3, 4])) };
  const result = await compare(
    { ...broken, "a.json": text(1) },
    { ...broken, "a.json": text(1) }
  );
  expect([...result.unreadable.keys()]).toEqual(["city_t.glb.gz"]);
  expect(result.equalByHash).toBe(1);
  expect(sameSites(result)).toBe(false);
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
  const result = await same(glbFile(glb), glbFile(again));
  expect(result.equalByContent).toBe(1);
});

test("a tile glb's property table is compared row by row, NaN not Infinity", async () => {
  expect(
    await glbLines(await writeMeshGlb(mesh()), await writeMeshGlb(mesh(0, 102)))
  ).toEqual(["property table [0].baseZ[0]: 100 → 102"]);
  expect(
    await glbLines(
      await writeMeshGlb(mesh(0, Number.NaN)),
      await writeMeshGlb(mesh(0, Number.POSITIVE_INFINITY))
    )
  ).toEqual(["property table [0].baseZ[0]: ⟪number⟫NaN → ⟪number⟫Infinity"]);
});

test("a quantised tile position three steps off differs", async () => {
  // 3 m extent over snorm16: a step is 3 / 32 767 m ≈ 0.09 mm
  const lines = await glbLines(
    await writeMeshGlb(mesh()),
    await writeMeshGlb(mesh(0.0003))
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith("mesh 0#0 POSITION: 1 values differ");
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
const pts = (xs: number[], flags = 0) => ({
  "canopy_t.pts.gz": gzipSync(packPoints(xs.map(point), origin, 3, flags)),
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
  expect(
    await onlyDiffers("canopy_t.pts.gz", pts([1, 2]), pts([1, 2], 1))
  ).toEqual([
    "stride 3, flags 0, origin 392000 5668000 → stride 3, flags 1, origin 392000 5668000",
  ]);
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

test("a file its reader refuses is unreadable, with the reason", async () => {
  const result = await compare(
    { "a.json": text(1) },
    { "a.json": new TextEncoder().encode("{not json") }
  );
  expect(result.unreadable.get("a.json")).toStartWith("SyntaxError");
  expect(sameSites(result)).toBe(false);
});

test("a PNG of another bit depth is refused, not read at 8 bits", async () => {
  const png = await grey(new Uint8Array([1, 2, 3, 4]), 9);
  png[24] = 16; // IHDR: bit depth
  const result = await compare({ "a.png": png }, { "a.png": png });
  expect(result.unreadable.get("a.png")).toContain("bit depth 16");
});

// --- the command ----------------------------------------------------------------------

function run(...args: string[]): number {
  const script = path.join(import.meta.dir, "compare-tilesets.ts");
  return Bun.spawnSync(["bun", script, ...args], {
    stderr: "ignore",
    stdout: "ignore",
  }).exitCode;
}

test("the command's tolerance flags reach the comparison", async () => {
  // the last vertex 9 mm apart, on 1 mm and on 1 cm steps
  const fine = publishedDir(glbFile(await glbOf({ grid: 0.001, z: 0.009 })));
  const coarse = publishedDir(glbFile(await glbOf({ grid: 0.01, z: 0 })));
  expect(run(fine, coarse)).toBe(1);
  expect(run(fine, coarse, "--within", "0.005")).toBe(1);
  expect(run(fine, coarse, "--within", "0.01")).toBe(0);
  // a unit tolerance is no tolerance for positions
  expect(run(fine, coarse, "--within-unit", "0.01")).toBe(1);
});

test("the command exits 0 when the same, 1 on a difference, 2 when it cannot read", () => {
  const a = publishedDir({ "a.json": text(1) });
  const b = publishedDir({ "a.json": text(2) });
  expect(run(a, a)).toBe(0);
  expect(run(a, b)).toBe(1);
  expect(run(a, fresh())).toBe(2);
  expect(run(a)).toBe(2);
  expect(run(a, a, "--within", "x")).toBe(2);
  expect(run(a, a, "--within", "0.01")).toBe(0);
  const broken = publishedDir({ "a.json": new TextEncoder().encode("{") });
  expect(run(broken, broken)).toBe(2);
});

test("a multiset keeps each copy of a row", () => {
  expect(multisetDiff(["a", "a", "b"], ["a", "b", "c"])).toEqual({
    onlyA: ["a"],
    onlyB: ["c"],
  });
});
