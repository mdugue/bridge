import { expect, test } from "bun:test";
import {
  budgetBreaches,
  budgetSpare,
  DEFAULT_PIPELINE_LIMITS,
  stageInterface,
  vertexAttributeNames,
  wgslBudget,
} from "./wgsl-budget";

/** A vertex shader in three's shape: attributes as `main`'s parameters,
 *  the varyings a struct it returns. */
function vertexText(opts: {
  attributes: number;
  varyings: number;
  clipDistances?: number;
}): string {
  const varyings = Array.from(
    { length: opts.varyings },
    (_, i) => `\t@location( ${i} ) v_${i} : vec3<f32>`
  );
  varyings.push("\t@builtin( position ) builtinClipSpace : vec4<f32>");
  if (opts.clipDistances) {
    varyings.push(
      `\t@builtin( clip_distances ) hw_clip_distances : array<f32, ${opts.clipDistances} >`
    );
  }
  const attributes = Array.from(
    { length: opts.attributes },
    (_, i) => `@location( ${i} ) a${i} : vec4<f32>`
  );
  attributes.push("@builtin( instance_index ) instanceIndex : u32");
  return `// Three.js r187 - WebGPU
struct VaryingsStruct {
${varyings.join(",\n")}
};
// a comment naming @location( 99 ) and fn main( nothing )
var<private> varyings : VaryingsStruct;

@vertex
fn main( ${attributes.join(",\n\t")} ) -> VaryingsStruct {
	varyings.builtinClipSpace = vec4<f32>( a0.xyz, 1.0 );
	return varyings;
}
`;
}

/** The fragment shader to go with it. */
function fragmentText(opts: { varyings: number; builtins?: string[] }): string {
  const inputs = Array.from(
    { length: opts.varyings },
    (_, i) => `@location( ${i} ) v_${i} : vec3<f32>`
  );
  for (const builtin of opts.builtins ?? []) {
    inputs.push(`@builtin( ${builtin} ) ${builtin}_in : u32`);
  }
  return `struct OutputStruct {
	@location( 0 ) color : vec4<f32>
};
var<private> output : OutputStruct;

@fragment
fn main( ${inputs.join(",\n\t")} ) -> OutputStruct {
	return output;
}
`;
}

const eightBuffers = { vertexBuffers: 8 };

test("counts attributes, the variables each way and the builtins", () => {
  const budget = wgslBudget(
    vertexText({ attributes: 5, varyings: 13 }),
    fragmentText({ varyings: 13, builtins: ["front_facing", "position"] })
  );
  expect(budget.attributes).toBe(5);
  expect(budget.interStageOut).toBe(13);
  expect(budget.interStageIn).toBe(13);
  expect(budget.maxOutLocation).toBe(12);
  expect(budget.clipDistances).toBe(0);
  expect(budget.builtins).toEqual({
    fragmentIn: ["front_facing", "position"],
    vertexIn: ["instance_index"],
    vertexOut: ["position"],
  });
  // front_facing takes a variable; the fragment's position does not
  expect(budget.interStageBuiltins).toEqual(["front_facing"]);
  expect(budgetSpare(budget, eightBuffers).interStage).toBe(2);
});

test("a comment's text is no part of the interface", () => {
  const vertex = vertexText({ attributes: 2, varyings: 1 });
  expect(vertexAttributeNames(vertex)).toEqual(["a0", "a1"]);
  expect(stageInterface(vertex, "vertex").outputs).toEqual([
    { location: 0, name: "v_0", type: "vec3<f32>" },
    { builtin: "position", name: "builtinClipSpace", type: "vec4<f32>" },
  ]);
});

test("an entry point may take a struct and return a bare location", () => {
  const fragment = `struct In {
  @location(0) @interpolate(flat, either) id : u32,
  @location(1) uv : vec2<f32>,
  @builtin(front_facing) front : bool,
}
@fragment fn shade(in : In, @builtin(sample_index) s : u32) -> @location(0) vec4<f32> {
  return vec4<f32>(in.uv, 0.0, 1.0);
}`;
  const io = stageInterface(fragment, "fragment");
  expect(io.inputs.map((v) => v.name)).toEqual(["id", "uv", "front", "s"]);
  expect(io.outputs).toEqual([{ location: 0, name: "", type: "vec4<f32>" }]);
  const budget = wgslBudget(
    vertexText({ attributes: 1, varyings: 2 }),
    fragment
  );
  expect(budget.interStageBuiltins).toEqual(["front_facing", "sample_index"]);
});

test("a text without the entry point is an error, not a zero", () => {
  expect(() => stageInterface("fn main() {}", "vertex")).toThrow(
    "no @vertex entry point"
  );
});

test("a shape the parser does not know is an error, never an empty count", () => {
  // an alias for the struct: its members would otherwise count as none
  const aliased = `struct In { @location(0) uv : vec2<f32> }
alias Inputs = In;
@fragment fn main(in : Inputs) -> @location(0) vec4<f32> { return vec4<f32>(); }`;
  expect(() => stageInterface(aliased, "fragment")).toThrow(
    "neither a location, a builtin nor a struct of them: in : Inputs"
  );
  // a location that is a constant, not a literal
  const named = `const UV = 3;
@fragment fn main(@location(UV) uv : vec2<f32>) -> @location(0) vec4<f32> { return vec4<f32>(); }`;
  expect(() => stageInterface(named, "fragment")).toThrow(
    "a location not a literal"
  );
  // clip distances sized by a constant
  const clipped = vertexText({ attributes: 1, varyings: 1 }).replace(
    "@builtin( position ) builtinClipSpace : vec4<f32>",
    "@builtin( position ) builtinClipSpace : vec4<f32>,\n\t@builtin( clip_distances ) clip : array<f32, PLANES>"
  );
  expect(() => wgslBudget(clipped, fragmentText({ varyings: 1 }))).toThrow(
    "clip_distances of an unread size"
  );
});

test("sixteen variables pass, a seventeenth does not", () => {
  const at = wgslBudget(
    vertexText({ attributes: 1, varyings: 16 }),
    fragmentText({ varyings: 16 })
  );
  expect(budgetSpare(at, eightBuffers).interStage).toBe(0);
  expect(budgetBreaches(at, eightBuffers)).toEqual([]);
  const over = wgslBudget(
    vertexText({ attributes: 1, varyings: 17 }),
    fragmentText({ varyings: 17 })
  );
  expect(budgetBreaches(over, eightBuffers)).toEqual([
    "fragmentInputs",
    "outLocations",
    "vertexOutputs",
  ]);
});

test("front_facing takes one of the fragment stage's sixteen", () => {
  const at = wgslBudget(
    vertexText({ attributes: 1, varyings: 15 }),
    fragmentText({ varyings: 15, builtins: ["front_facing"] })
  );
  expect(budgetSpare(at, eightBuffers)).toMatchObject({
    fragmentInputs: 0,
    interStage: 0,
    vertexOutputs: 1,
  });
  expect(budgetBreaches(at, eightBuffers)).toEqual([]);
  // the vertex stage may write all sixteen; the fragment stage, reading
  // front_facing, may take fifteen of them
  const over = wgslBudget(
    vertexText({ attributes: 1, varyings: 16 }),
    fragmentText({ varyings: 16, builtins: ["front_facing"] })
  );
  expect(budgetBreaches(over, eightBuffers)).toEqual(["fragmentInputs"]);
  // a builtin that does not count leaves all sixteen
  const position = wgslBudget(
    vertexText({ attributes: 1, varyings: 16 }),
    fragmentText({ varyings: 16, builtins: ["position"] })
  );
  expect(budgetBreaches(position, eightBuffers)).toEqual([]);
});

test("clip distances take a variable for every four, on the vertex side", () => {
  const cut = wgslBudget(
    vertexText({ attributes: 1, varyings: 15, clipDistances: 4 }),
    fragmentText({ varyings: 15, builtins: ["front_facing"] })
  );
  expect(cut.clipDistances).toBe(4);
  expect(budgetSpare(cut, eightBuffers)).toMatchObject({
    outLocations: 0,
    vertexOutputs: 0,
  });
  expect(budgetBreaches(cut, eightBuffers)).toEqual([]);
  const five = wgslBudget(
    vertexText({ attributes: 1, varyings: 15, clipDistances: 5 }),
    fragmentText({ varyings: 15, builtins: ["front_facing"] })
  );
  expect(budgetBreaches(five, eightBuffers)).toEqual([
    "outLocations",
    "vertexOutputs",
  ]);
});

test("a point list's vertex stage passes one variable fewer", () => {
  const points = wgslBudget(
    vertexText({ attributes: 1, varyings: 16 }),
    fragmentText({ varyings: 16 })
  );
  expect(budgetBreaches(points, { pointList: true, vertexBuffers: 1 })).toEqual(
    ["vertexOutputs"]
  );
});

test("eight vertex buffers pass, a ninth does not; sixteen attributes too", () => {
  const budget = wgslBudget(
    vertexText({ attributes: 16, varyings: 1 }),
    fragmentText({ varyings: 1 })
  );
  expect(budgetBreaches(budget, { vertexBuffers: 8 })).toEqual([]);
  expect(budgetBreaches(budget, { vertexBuffers: 9 })).toEqual([
    "vertexBuffers",
  ]);
  const seventeen = wgslBudget(
    vertexText({ attributes: 17, varyings: 1 }),
    fragmentText({ varyings: 1 })
  );
  expect(budgetBreaches(seventeen, eightBuffers)).toEqual(["vertexAttributes"]);
  // a device that was asked for more holds a pipeline to its own limits
  expect(
    budgetBreaches(
      budget,
      { vertexBuffers: 9 },
      { ...DEFAULT_PIPELINE_LIMITS, maxVertexBuffers: 12 }
    )
  ).toEqual([]);
});
