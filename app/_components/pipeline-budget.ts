/**
 * The limits probe (plan 094): a row for every build the scene draws with
 * — its key, layout and kind of camera, the vertex buffers its geometry
 * feeds it from, and what its WGSL asks of WebGPU's per-pipeline limits
 * (lib/city/wgsl-budget.ts). The e2e "limits" test reads it through the
 * debug hook (`handle.getPipelineBudget()`); a production build answers
 * with no rows.
 *
 * Public API only: the text is `renderer.debug.getShaderAsync`'s, asked
 * through the post stack's turn (`PostStack.shadersOf`); the buffers are
 * counted on the geometry the way three lays a pipeline out — one buffer
 * for each attribute the vertex stage names, an interleaved buffer once
 * for all its attributes.
 */

import type { BufferGeometry, Camera, Material, Object3D } from "three/webgpu";
import {
  budgetBreaches,
  budgetSpare,
  DEFAULT_PIPELINE_LIMITS,
  vertexAttributeNames,
  wgslBudget,
} from "@/lib/city/wgsl-budget";
import type {
  BudgetSpare,
  PipelineLimits,
  WgslBudget,
} from "@/lib/city/wgsl-budget";
import { graphOf } from "./material-slots";
import { pocEnabled } from "./poc-scene";
import type { PostStack } from "./post-stack";
import { compileRepresentatives, layoutOf } from "./three-utils";

/** One build the scene draws with. */
export interface PipelineBudgetRow {
  /** the limits it crosses; empty for a pipeline WebGPU accepts */
  breaches: (keyof BudgetSpare)[];
  budget: WgslBudget;
  /** the kind of camera it was built for (three r187 keys a build by it) */
  camera: "parallel" | "perspective";
  /** the object's type: Mesh, LineSegments, Points … */
  draw: string;
  /** the shared build the material names (`setGraph`), else its
   *  scene-wide key (`sceneMaterial`), else its name, else its type */
  key: string;
  /** the geometry's attribute names (`layoutOf`) */
  layout: string;
  receiveShadow: boolean;
  /** the two WGSL texts, where asked for (`shaders`) */
  shaders?: { fragment: string; vertex: string };
  spare: BudgetSpare;
  /** attributes the vertex stage names that the geometry does not have
   *  (each counted as a buffer of its own) */
  unmatched: string[];
  /** the distinct buffers the vertex stage's attributes come from */
  vertexBuffers: number;
}

/** `SceneApp.getPipelineBudget`'s report. */
export interface PipelineBudget {
  /** the device's limits (a production build: WebGPU's defaults, unread) */
  limits: PipelineLimits;
  rows: PipelineBudgetRow[];
  /** representatives whose tile left before or while they were read:
   *  never compiled, no build of the scene any more */
  left: number;
  /** representatives still in the scene no text could be had for: a
   *  material array, a cut held meanwhile */
  unread: number;
}

/** What the probe is asked. */
export interface PipelineBudgetQuery {
  /** carry the WGSL of the rows whose key starts with this */
  shaders?: string;
}

type Drawable = Object3D & {
  geometry?: BufferGeometry;
  isPoints?: boolean;
  material?: Material | Material[];
};

/**
 * The device's own limits, read off three's backend. One that cannot be
 * read is an error: the defaults in its place would hold the scene to
 * limits the device may not have, and the spec asserts exactly those.
 */
function deviceLimits(renderer: object): PipelineLimits {
  // reason: the backend's `device` is the GPUDevice, typed only on the
  // WebGPU backend's class
  const limits = (
    renderer as { backend?: { device?: { limits?: Partial<PipelineLimits> } } }
  ).backend?.device?.limits;
  const read = (name: keyof PipelineLimits): number => {
    const value = limits?.[name];
    if (typeof value !== "number") {
      throw new TypeError(`pipeline-budget: the device reports no ${name}`);
    }
    return value;
  };
  return {
    maxInterStageShaderVariables: read("maxInterStageShaderVariables"),
    maxVertexAttributes: read("maxVertexAttributes"),
    maxVertexBuffers: read("maxVertexBuffers"),
  };
}

/**
 * The distinct vertex buffers `names` come from on `geometry`: three makes
 * one buffer layout for each attribute, and one for an interleaved buffer
 * whatever number of attributes read it.
 */
export function vertexBuffersOf(
  geometry: BufferGeometry | undefined,
  names: readonly string[]
): { buffers: number; unmatched: string[] } {
  const buffers = new Set<object>();
  const unmatched: string[] = [];
  for (const name of names) {
    const attribute = geometry?.attributes[name] as
      | { data?: object; isInterleavedBufferAttribute?: boolean }
      | undefined;
    if (!attribute) {
      unmatched.push(name);
    } else if (attribute.isInterleavedBufferAttribute && attribute.data) {
      buffers.add(attribute.data);
    } else {
      buffers.add(attribute);
    }
  }
  return { buffers: buffers.size + unmatched.length, unmatched };
}

const keyOf = (material: Material): string => {
  const scene: unknown = material.userData.sceneKey;
  return (
    graphOf(material) ??
    (typeof scene === "string" ? scene : material.name || material.type)
  );
};

/** What tells two representatives' builds apart: a material that shares a
 *  build (a graph, a scene-wide material) by its key, any other by itself. */
function buildOf(object: Drawable, material: Material): string {
  const shared = graphOf(material) ?? material.uuid;
  return `${shared}|${object.type}|${layoutOf(object.geometry)}|${object.receiveShadow}`;
}

/** Whether `object` still hangs under `root`: a tile that left took its
 *  content out of the scene. */
function under(object: Object3D, root: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o === root) {
      return true;
    }
  }
  return false;
}

/**
 * A row for each build under `root`, as `view` draws them. Each is one
 * read in the compiles' turn; the scene keeps drawing meanwhile, so a
 * tile may leave between two reads: what no longer hangs under `root` is
 * not asked for (a read compiles first, and compiling what a tile has
 * freed would upload it again), and counted as `left`.
 */
export async function budgetRows(
  stack: Pick<PostStack, "shadersOf">,
  root: Object3D,
  view: Camera,
  limits: PipelineLimits,
  query: PipelineBudgetQuery = {}
): Promise<PipelineBudget> {
  const report: PipelineBudget = { left: 0, limits, rows: [], unread: 0 };
  const camera = (view as { isOrthographicCamera?: boolean })
    .isOrthographicCamera
    ? "parallel"
    : "perspective";
  const seen = new Set<string>();
  for (const object of compileRepresentatives([root]) as Drawable[]) {
    const { material } = object;
    if (!material || Array.isArray(material)) {
      report.unread += 1;
      continue;
    }
    const build = buildOf(object, material);
    if (seen.has(build)) {
      continue;
    }
    if (!under(object, root)) {
      report.left += 1;
      continue;
    }
    seen.add(build);
    const shaders = await stack.shadersOf(object, view);
    if (!(shaders?.vertexShader && shaders.fragmentShader)) {
      // gone during its own read, or unreadable where it is
      report[under(object, root) ? "unread" : "left"] += 1;
      continue;
    }
    const { vertexShader: vertex, fragmentShader: fragment } = shaders;
    const budget = wgslBudget(vertex, fragment);
    const { buffers, unmatched } = vertexBuffersOf(
      object.geometry,
      vertexAttributeNames(vertex)
    );
    const shape = {
      pointList: object.isPoints === true,
      vertexBuffers: buffers,
    };
    const key = keyOf(material);
    report.rows.push({
      breaches: budgetBreaches(budget, shape, limits),
      budget,
      camera,
      draw: object.type,
      key,
      layout: layoutOf(object.geometry),
      receiveShadow: object.receiveShadow,
      spare: budgetSpare(budget, shape, limits),
      unmatched,
      vertexBuffers: buffers,
      ...(query.shaders !== undefined && key.startsWith(query.shaders)
        ? { shaders: { fragment, vertex } }
        : {}),
    });
  }
  return report;
}

/**
 * `budgetRows` for the scene, held to its device's limits. Debug builds
 * only: a production build answers with no rows.
 */
export async function pipelineBudget(
  renderer: object,
  stack: Pick<PostStack, "shadersOf">,
  root: Object3D,
  view: Camera,
  query: PipelineBudgetQuery = {}
): Promise<PipelineBudget> {
  if (!pocEnabled) {
    const limits = DEFAULT_PIPELINE_LIMITS;
    return { left: 0, limits, rows: [], unread: 0 };
  }
  return await budgetRows(stack, root, view, deviceLimits(renderer), query);
}
