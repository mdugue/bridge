import { describe, expect, test } from "bun:test";

import { Accessor, Document, NodeIO, Primitive } from "@gltf-transform/core";
import type { GLTF } from "@gltf-transform/core";
import { weld } from "@gltf-transform/functions";

import { weldExact, weldRemap } from "./glb-weld";

/** A seeded mesh with many repeated corners: every vertex is drawn from a
 *  small pool, so the weld merges most of them and probes collide. */
function meshDoc(options: {
  seed: number;
  vertices: number;
  pool: number;
  indexed: boolean;
  colour?: "u8x3" | "u8x4";
  mode?: GLTF.MeshPrimitiveMode;
}): Document {
  let s = options.seed;
  const rand = () => {
    s = (Math.imul(s, 1_103_515_245) + 12_345) >>> 0;
    return s / 2 ** 32;
  };
  const doc = new Document();
  const buffer = doc.createBuffer();
  const poolPos = Array.from({ length: options.pool }, () => [
    rand(),
    rand(),
    rand(),
  ]);
  // two normals per position: a corner shared by two faces
  const poolNormal = [
    [0, 1, 0],
    [1, 0, 0],
  ];
  const position = new Float32Array(options.vertices * 3);
  const normal = new Float32Array(options.vertices * 3);
  const colour = new Uint8Array(
    options.vertices * (options.colour === "u8x3" ? 3 : 4)
  );
  for (let v = 0; v < options.vertices; v++) {
    const p = poolPos[Math.floor(rand() * options.pool)];
    const n = poolNormal[rand() < 0.5 ? 0 : 1];
    position.set(p, v * 3);
    normal.set(n, v * 3);
    colour.fill(p[0] < 0.5 ? 200 : 40, v * (colour.length / options.vertices));
  }
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(position).setBuffer(buffer)
    )
    .setAttribute(
      "NORMAL",
      doc.createAccessor().setType("VEC3").setArray(normal).setBuffer(buffer)
    );
  if (options.colour) {
    prim.setAttribute(
      "COLOR_0",
      doc
        .createAccessor()
        .setType(options.colour === "u8x3" ? "VEC3" : "VEC4")
        .setNormalized(true)
        .setArray(colour)
        .setBuffer(buffer)
    );
  }
  if (options.indexed) {
    const index = new Uint32Array(options.vertices * 2);
    for (let i = 0; i < index.length; i++) {
      index[i] = Math.floor(rand() * options.vertices);
    }
    prim.setIndices(
      doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(index)
    );
  }
  if (options.mode !== undefined) {
    prim.setMode(options.mode);
  }
  doc
    .createScene()
    .addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return doc;
}

/** The city glb's layout: positions on a half-metre grid and axis normals
 *  (words with empty low bits), a float feature id and a snorm16 facade
 *  vec4; a second mesh with a 3-byte colour that only `weldPrimitive` can
 *  weld; optionally an empty mesh, which `weld` prunes. */
function buildingDoc(seed: number, emptyMesh = false): Document {
  let s = seed;
  const rand = (n: number) => {
    s = (Math.imul(s, 1_103_515_245) + 12_345) >>> 0;
    return Math.floor((s / 2 ** 32) * n);
  };
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (
    type: "SCALAR" | "VEC3" | "VEC4",
    array:
      | Float32Array<ArrayBuffer>
      | Int16Array<ArrayBuffer>
      | Uint8Array<ArrayBuffer>
      | Uint32Array<ArrayBuffer>
  ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const vertices = 6000;
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const feature = new Float32Array(vertices);
  const facade = new Int16Array(vertices * 4);
  const colour = new Uint8Array(vertices * 3);
  for (let v = 0; v < vertices; v++) {
    position.set([rand(12) / 2, rand(8) / 2, -rand(12) / 2], v * 3);
    normal[v * 3 + rand(3)] = rand(2) === 0 ? 1 : -1;
    feature[v] = rand(4);
    facade.set([rand(3) * 1000, 0, rand(2) === 0 ? -32_767 : 0, 0], v * 4);
    colour.fill(rand(2) * 100, v * 3, v * 3 + 3);
  }
  const index = new Uint32Array(vertices * 2);
  for (let i = 0; i < index.length; i++) {
    index[i] = rand(vertices);
  }
  const building = doc
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", position))
    .setAttribute("NORMAL", accessor("VEC3", normal))
    .setAttribute("_FEATURE_ID_0", accessor("SCALAR", feature))
    .setAttribute("_FACADE", accessor("VEC4", facade).setNormalized(true))
    .setIndices(accessor("SCALAR", index));
  const coloured = doc
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", position.slice()))
    .setAttribute("COLOR_0", accessor("VEC3", colour).setNormalized(true));
  const scene = doc.createScene();
  scene.addChild(
    doc.createNode().setMesh(doc.createMesh().addPrimitive(building))
  );
  scene.addChild(
    doc.createNode().setMesh(doc.createMesh().addPrimitive(coloured))
  );
  if (emptyMesh) {
    scene.addChild(doc.createNode().setMesh(doc.createMesh()));
  }
  return doc;
}

async function glbOf(
  build: () => Document,
  transform: typeof weld
): Promise<Uint8Array> {
  const doc = build();
  await doc.transform(transform());
  return new NodeIO().writeBinary(doc);
}

const CASES: [string, Parameters<typeof meshDoc>[0]][] = [
  ["indexed", { seed: 1, vertices: 4000, pool: 300, indexed: true }],
  ["unindexed", { seed: 2, vertices: 3000, pool: 200, indexed: false }],
  [
    "with an RGBA colour",
    { seed: 3, vertices: 2000, pool: 150, indexed: true, colour: "u8x4" },
  ],
  // welded by weldPrimitive: a 3-byte colour is no whole word
  [
    "with a 3-byte colour",
    { seed: 4, vertices: 2000, pool: 150, indexed: true, colour: "u8x3" },
  ],
  // left to weldPrimitive: points are not welded
  [
    "of points",
    {
      seed: 5,
      vertices: 500,
      pool: 50,
      indexed: false,
      mode: Primitive.Mode.POINTS,
    },
  ],
];

describe("weldExact", () => {
  for (const [name, options] of CASES) {
    test(`writes the same glb as weld, ${name}`, async () => {
      const ours = await glbOf(() => meshDoc(options), weldExact);
      const theirs = await glbOf(() => meshDoc(options), weld);
      expect(Buffer.from(ours).equals(Buffer.from(theirs))).toBe(true);
    });
  }

  test("writes the same glb as weld, the city's layout beside a mesh only weldPrimitive welds", async () => {
    const ours = await glbOf(() => buildingDoc(7), weldExact);
    const theirs = await glbOf(() => buildingDoc(7), weld);
    expect(Buffer.from(ours).equals(Buffer.from(theirs))).toBe(true);
  });

  test("prunes an empty mesh as weld does", async () => {
    const ours = await glbOf(() => buildingDoc(8, true), weldExact);
    const theirs = await glbOf(() => buildingDoc(8, true), weld);
    expect(Buffer.from(ours).equals(Buffer.from(theirs))).toBe(true);
  });

  test("refuses a primitive without positions, as weld does", async () => {
    const doc = new Document();
    const prim = doc
      .createPrimitive()
      .setAttribute(
        "NORMAL",
        doc.createAccessor().setType("VEC3").setArray(new Float32Array(9))
      );
    doc.createMesh().addPrimitive(prim);
    const failure = await doc.transform(weldExact()).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(Error);
  });

  test("merges what weld merges", async () => {
    const doc = meshDoc({ seed: 6, vertices: 4000, pool: 300, indexed: true });
    await doc.transform(weldExact());
    const count = doc
      .getRoot()
      .listMeshes()[0]
      .listPrimitives()[0]
      .getAttribute("POSITION")
      ?.getCount();
    // at most 300 positions × 2 normals survive
    expect(count).toBeLessThanOrEqual(600);
    expect(count).toBeGreaterThan(0);
  });
});

describe("weldRemap", () => {
  test("numbers merged vertices in first-use order", () => {
    // vertices 0 and 2 are equal, 1 and 3 are equal
    const words = new Uint32Array([5, 6, 7, 8, 5, 6, 7, 8]);
    const { remap, count } = weldRemap([{ words, stride: 2 }], 4, [3, 0, 1, 2]);
    expect(count).toBe(2);
    expect([...remap]).toEqual([1, 0, 1, 0]);
  });

  test("tells vertices apart by any attribute", () => {
    const position = new Uint32Array([1, 1, 1, 1]);
    const normal = new Uint32Array([0, 9, 0, 9]);
    const { remap, count } = weldRemap(
      [
        { words: position, stride: 1 },
        { words: normal, stride: 1 },
      ],
      4,
      null
    );
    expect(count).toBe(2);
    expect([...remap]).toEqual([0, 1, 0, 1]);
  });
});
