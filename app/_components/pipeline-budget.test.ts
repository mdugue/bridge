import { expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
} from "three/webgpu";
import { budgetBreaches } from "@/lib/city/wgsl-budget";
import type { WgslBudget } from "@/lib/city/wgsl-budget";
import { vertexBuffersOf } from "./pipeline-budget";

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

test("an attribute the geometry lacks is named, and counted as a buffer", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", plain());
  expect(vertexBuffersOf(geometry, ["position", "aGone"])).toEqual({
    buffers: 2,
    unmatched: ["aGone"],
  });
});
