import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import nodePath from "node:path";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
} from "three/webgpu";
import type { Object3D } from "three/webgpu";
import {
  budgetBreaches,
  DEFAULT_PIPELINE_LIMITS,
} from "@/lib/city/wgsl-budget";
import type { WgslBudget } from "@/lib/city/wgsl-budget";
import { budgetRows, vertexBuffersOf } from "./pipeline-budget";

const plain = () => new BufferAttribute(new Float32Array(3), 1);

/** A budget that asks nothing but its attributes. */
const budgetOf = (attributes: number): WgslBudget => ({
  attributes,
  builtins: { fragmentIn: [], vertexIn: [], vertexOut: ["position"] },
  clipDistances: 0,
  interStageBuiltins: [],
  interStageIn: 0,
  interStageOut: 0,
  maxOutLocation: -1,
});

test("each plain attribute the vertex stage names is one buffer", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", plain());
  geometry.setAttribute("normal", plain());
  // one the shader does not read is no buffer of the pipeline
  geometry.setAttribute("unread", plain());
  expect(vertexBuffersOf(geometry, ["position", "normal"])).toEqual({
    buffers: 2,
    unmatched: [],
  });
});

test("an interleaved instance matrix is one buffer for its four columns", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", plain());
  const matrices = new InstancedInterleavedBuffer(new Float32Array(16), 16);
  const columns = ["iMat0", "iMat1", "iMat2", "iMat3"];
  for (const [i, name] of columns.entries()) {
    geometry.setAttribute(
      name,
      new InterleavedBufferAttribute(matrices, 4, i * 4)
    );
  }
  expect(vertexBuffersOf(geometry, ["position", ...columns]).buffers).toBe(2);
});

test("a ninth plain attribute is a ninth buffer, and a breach", () => {
  const geometry = new BufferGeometry();
  const names = Array.from({ length: 9 }, (_, i) => `a${i}`);
  for (const name of names.slice(0, 8)) {
    geometry.setAttribute(name, plain());
  }
  const eight = vertexBuffersOf(geometry, names.slice(0, 8));
  expect(eight.buffers).toBe(8);
  expect(budgetBreaches(budgetOf(8), { vertexBuffers: eight.buffers })).toEqual(
    []
  );
  geometry.setAttribute(names[8], plain());
  const nine = vertexBuffersOf(geometry, names);
  expect(nine.buffers).toBe(9);
  expect(budgetBreaches(budgetOf(9), { vertexBuffers: nine.buffers })).toEqual([
    "vertexBuffers",
  ]);
});

const fixture = (name: string) =>
  readFileSync(
    nodePath.join(
      import.meta.dir,
      "..",
      "..",
      "lib",
      "city",
      "__fixtures__",
      "wgsl-budget",
      name
    ),
    "utf-8"
  );

/** A mesh in the clay's layout, each attribute a buffer of its own. */
function clayMesh(): Mesh {
  const geometry = new BufferGeometry();
  for (const name of ["featureId", "facade", "position", "normal"]) {
    geometry.setAttribute(name, plain());
  }
  const material = new MeshBasicNodeMaterial();
  material.name = "clay-stand-in";
  return new Mesh(geometry, material);
}

test("a row a build: the clay's texts on the clay's layout", async () => {
  const root = new Group();
  root.add(clayMesh());
  // a second tile's mesh on its own material is a build of its own
  root.add(clayMesh());
  const asked: Object3D[] = [];
  const budget = await budgetRows(
    {
      shadersOf: async (object) => {
        asked.push(object);
        return {
          fragmentShader: fixture("clay.fragment.wgsl"),
          vertexShader: fixture("clay.vertex.wgsl"),
        };
      },
    },
    root,
    new PerspectiveCamera(),
    DEFAULT_PIPELINE_LIMITS
  );
  expect(asked).toHaveLength(2);
  expect(budget.unread).toBe(0);
  expect(budget.left).toBe(0);
  expect(budget.rows[0]).toMatchObject({
    breaches: [],
    camera: "perspective",
    draw: "Mesh",
    key: "clay-stand-in",
    layout: "facade,featureId,normal,position",
    unmatched: [],
    vertexBuffers: 4,
  });
  expect(budget.rows[0].spare.interStage).toBe(2);
});

test("a tile that left while the rows were read is not asked for", async () => {
  const root = new Group();
  const first = clayMesh();
  const second = clayMesh();
  root.add(first, second);
  const asked: Object3D[] = [];
  const budget = await budgetRows(
    {
      shadersOf: async (object) => {
        asked.push(object);
        // the second tile leaves while the first is read
        root.remove(second);
        return {
          fragmentShader: fixture("clay.fragment.wgsl"),
          vertexShader: fixture("clay.vertex.wgsl"),
        };
      },
    },
    root,
    new PerspectiveCamera(),
    DEFAULT_PIPELINE_LIMITS
  );
  expect(asked).toEqual([first]);
  expect(budget.rows).toHaveLength(1);
  expect(budget.left).toBe(1);
  expect(budget.unread).toBe(0);
});
