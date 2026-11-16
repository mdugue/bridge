/**
 * What a pair of WGSL shaders asks of WebGPU's per-pipeline limits: the
 * vertex stage's attributes, the variables it hands the fragment stage,
 * and the builtins that count against them (plan 094). Past a limit the
 * pipeline is invalid and its mesh draws nothing, with no error a test
 * sees — so the limits are counted from the text three builds
 * (`renderer.debug.getShaderAsync`), in the headless e2e.
 *
 * The rules are the WebGPU specification's, "validating inter-stage
 * interfaces" and "validating GPURenderPipelineDescriptor":
 *
 * - the vertex stage may have `maxInterStageShaderVariables` user-defined
 *   outputs, one fewer on a point list, and one fewer for every four
 *   `clip_distances` (which lower the highest location allowed as well);
 * - the fragment stage may have as many user-defined inputs, one fewer
 *   for each inter-stage builtin it reads (`front_facing`, `sample_index`,
 *   `sample_mask`, `primitive_index`, the subgroup ones) — `position`
 *   does not count;
 * - a pipeline has at most `maxVertexBuffers` buffers and
 *   `maxVertexAttributes` attributes. Buffers are not in the text: the
 *   caller counts them on the geometry.
 *
 * Pure: text in, counts out. No three, no DOM.
 */

/** One input or output of an entry point. */
export interface StageVariable {
  /** `@builtin(…)`'s name, if it is one */
  builtin?: string;
  /** `@location(…)`, if it is user-defined */
  location?: number;
  name: string;
  type: string;
}

/** An entry point's interface. */
export interface StageInterface {
  inputs: StageVariable[];
  outputs: StageVariable[];
}

/** What a vertex and fragment shader pair asks of the limits. */
export interface WgslBudget {
  /** the vertex stage's user-defined inputs */
  attributes: number;
  /** every builtin either stage names, by stage and direction */
  builtins: { fragmentIn: string[]; vertexIn: string[]; vertexOut: string[] };
  /** the size of the vertex stage's `clip_distances` output, 0 without */
  clipDistances: number;
  /** the fragment stage's builtins that each take one variable */
  interStageBuiltins: string[];
  /** the fragment stage's user-defined inputs */
  interStageIn: number;
  /** the vertex stage's user-defined outputs */
  interStageOut: number;
  /** the highest `@location` among the vertex stage's outputs, −1 without */
  maxOutLocation: number;
}

/** The device limits a render pipeline is held to. */
export interface PipelineLimits {
  maxInterStageShaderVariables: number;
  maxVertexAttributes: number;
  maxVertexBuffers: number;
}

/** WebGPU's defaults, which a device made without `requiredLimits` has. */
export const DEFAULT_PIPELINE_LIMITS: PipelineLimits = {
  maxInterStageShaderVariables: 16,
  maxVertexAttributes: 16,
  maxVertexBuffers: 8,
};

/** The fragment builtins the specification lists as inter-stage. */
const INTER_STAGE_BUILTINS = new Set([
  "front_facing",
  "sample_index",
  "sample_mask",
  "primitive_index",
  "subgroup_invocation_id",
  "subgroup_size",
]);

const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu;
const STRUCT = /\bstruct\s+(?<name>\w+)\s*\{/gu;
const LOCATION = /@location\s*\(\s*(?<index>\d+)\s*\)/u;
const BUILTIN = /@builtin\s*\(\s*(?<name>\w+)\s*\)/u;
const ATTRIBUTE = /@\w+\s*(?:\([^()]*\))?/gu;
const ARRAY_SIZE = /^array\s*<[^,]+,\s*(?<size>\d+)\s*>$/u;

const OPEN: Record<string, string> = { "(": ")", "<": ">", "{": "}" };

/** The index of the bracket closing the one at `open`. */
function closing(text: string, open: number): number {
  const up = text[open];
  const down = OPEN[up];
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === up) {
      depth += 1;
    } else if (text[i] === down) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error(`wgsl-budget: unclosed ${up} at ${open}`);
}

/** `list` split at the commas outside every bracket. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (c === "(" || c === "<") {
      depth += 1;
    } else if (c === ")" || c === ">") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(list.slice(from));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** One declaration, `@attributes name : type` (or a bare `@attributes
 *  type`, a function's return). */
function variableOf(declaration: string): StageVariable {
  const location = LOCATION.exec(declaration);
  const builtin = BUILTIN.exec(declaration);
  const bare = declaration.replaceAll(ATTRIBUTE, "").trim();
  const colon = bare.indexOf(":");
  const variable: StageVariable = {
    name: colon === -1 ? "" : bare.slice(0, colon).trim(),
    type: (colon === -1 ? bare : bare.slice(colon + 1))
      .replaceAll(/\s+/gu, " ")
      .trim(),
  };
  if (location) {
    variable.location = Number(location.groups?.index);
  }
  if (builtin) {
    variable.builtin = builtin.groups?.name;
  }
  return variable;
}

/** Every struct of `text`, its members by its name. */
function structsOf(text: string): Map<string, StageVariable[]> {
  const structs = new Map<string, StageVariable[]>();
  for (const match of text.matchAll(STRUCT)) {
    const open = match.index + match[0].length - 1;
    const body = text.slice(open + 1, closing(text, open));
    structs.set(match.groups?.name ?? "", splitTopLevel(body).map(variableOf));
  }
  return structs;
}

/** The variables a declaration stands for: itself, or its struct's
 *  members. */
function flattened(
  variable: StageVariable,
  structs: Map<string, StageVariable[]>
): StageVariable[] {
  if (variable.location !== undefined || variable.builtin !== undefined) {
    return [variable];
  }
  return structs.get(variable.type) ?? [];
}

/**
 * The interface of `text`'s entry point for `stage`: its parameters and
 * what it returns, structs flattened into their members.
 */
export function stageInterface(
  text: string,
  stage: "fragment" | "vertex"
): StageInterface {
  const source = text.replaceAll(COMMENTS, "");
  const entry = new RegExp(`@${stage}\\b[^{;]*?\\bfn\\s+\\w+\\s*\\(`, "u").exec(
    source
  );
  if (!entry) {
    throw new Error(`wgsl-budget: no @${stage} entry point`);
  }
  const open = entry.index + entry[0].length - 1;
  const close = closing(source, open);
  const structs = structsOf(source);
  const inputs = splitTopLevel(source.slice(open + 1, close))
    .map(variableOf)
    .flatMap((v) => flattened(v, structs));
  const body = source.indexOf("{", close);
  const returned = /^\s*->\s*(?<type>[\s\S]+)$/u.exec(
    source.slice(close + 1, body)
  );
  const outputs = returned
    ? flattened(variableOf(returned.groups?.type ?? ""), structs)
    : [];
  return { inputs, outputs };
}

const userDefined = (list: StageVariable[]) =>
  list.filter((v) => v.location !== undefined);

const builtinsOf = (list: StageVariable[]) =>
  list.flatMap((v) => (v.builtin === undefined ? [] : [v.builtin]));

/** What `vertex` and `fragment`, a pipeline's two WGSL texts, ask of the
 *  limits. */
export function wgslBudget(vertex: string, fragment: string): WgslBudget {
  const v = stageInterface(vertex, "vertex");
  const f = stageInterface(fragment, "fragment");
  const clip = v.outputs.find((o) => o.builtin === "clip_distances");
  const fragmentIn = builtinsOf(f.inputs);
  return {
    attributes: userDefined(v.inputs).length,
    builtins: {
      fragmentIn,
      vertexIn: builtinsOf(v.inputs),
      vertexOut: builtinsOf(v.outputs),
    },
    clipDistances: clip
      ? Number(ARRAY_SIZE.exec(clip.type)?.groups?.size ?? 1)
      : 0,
    interStageBuiltins: fragmentIn.filter((b) => INTER_STAGE_BUILTINS.has(b)),
    interStageIn: userDefined(f.inputs).length,
    interStageOut: userDefined(v.outputs).length,
    maxOutLocation: Math.max(
      -1,
      ...userDefined(v.outputs).map((o) => o.location ?? -1)
    ),
  };
}

/** The names of the vertex stage's attributes, as the geometry has them. */
export function vertexAttributeNames(vertex: string): string[] {
  return userDefined(stageInterface(vertex, "vertex").inputs).map(
    (v) => v.name
  );
}

/** How a pipeline is drawn, where the limits ask. */
export interface PipelineShape {
  /** a point list's vertex stage may pass one variable fewer */
  pointList?: boolean;
  /** the distinct vertex buffers its attributes come from */
  vertexBuffers: number;
}

/** What `budget` leaves of each limit; a negative figure is a pipeline
 *  WebGPU refuses. */
export interface BudgetSpare {
  /** user-defined inputs the fragment stage could still take */
  fragmentInputs: number;
  /** the fewer of the two stages' spare variables: what a new varying
   *  has to fit into */
  interStage: number;
  /** locations left under the highest the vertex stage may write */
  outLocations: number;
  vertexAttributes: number;
  vertexBuffers: number;
  /** user-defined outputs the vertex stage could still write */
  vertexOutputs: number;
}

/** What is left of each limit, by the specification's own steps. */
export function budgetSpare(
  budget: WgslBudget,
  shape: PipelineShape,
  limits: PipelineLimits = DEFAULT_PIPELINE_LIMITS
): BudgetSpare {
  const clip = Math.ceil(budget.clipDistances / 4);
  const max = limits.maxInterStageShaderVariables;
  const vertexOutputs =
    max - (shape.pointList ? 1 : 0) - clip - budget.interStageOut;
  const fragmentInputs =
    max - budget.interStageBuiltins.length - budget.interStageIn;
  return {
    fragmentInputs,
    interStage: Math.min(vertexOutputs, fragmentInputs),
    outLocations: max - 1 - clip - budget.maxOutLocation,
    vertexAttributes: limits.maxVertexAttributes - budget.attributes,
    vertexBuffers: limits.maxVertexBuffers - shape.vertexBuffers,
    vertexOutputs,
  };
}

/** The limits `budget` crosses, by name; empty for a valid pipeline. */
export function budgetBreaches(
  budget: WgslBudget,
  shape: PipelineShape,
  limits: PipelineLimits = DEFAULT_PIPELINE_LIMITS
): (keyof BudgetSpare)[] {
  const spare = budgetSpare(budget, shape, limits);
  return (Object.keys(spare) as (keyof BudgetSpare)[])
    .filter((limit) => limit !== "interStage" && spare[limit] < 0)
    .sort();
}
