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
  /** the shared build the material names (`setGraph`), else its name,
   *  else its type */
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
  /** the device's limits, WebGPU's defaults where it does not say */
  limits: PipelineLimits;
  rows: PipelineBudgetRow[];
  /** representatives no text could be had for: a material array, a tile
   *  that left, a cut held meanwhile */
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

/** The device's own limits, read off three's backend. */
function deviceLimits(renderer: object): PipelineLimits {
  // reason: the backend's `device` is the GPUDevice, typed only on the
  // WebGPU backend's class
  const limits = (
    renderer as { backend?: { device?: { limits?: Partial<PipelineLimits> } } }
  ).backend?.device?.limits;
  return {
    maxInterStageShaderVariables:
      limits?.maxInterStageShaderVariables ??
      DEFAULT_PIPELINE_LIMITS.maxInterStageShaderVariables,
    maxVertexAttributes:
      limits?.maxVertexAttributes ??
      DEFAULT_PIPELINE_LIMITS.maxVertexAttributes,
    maxVertexBuffers:
      limits?.maxVertexBuffers ?? DEFAULT_PIPELINE_LIMITS.maxVertexBuffers,
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

const keyOf = (material: Material): string =>
  graphOf(material) ?? (material.name || material.type);

/** What tells two representatives' builds apart: a material that shares a
 *  build (a graph, a scene-wide material) by its key, any other by itself. */
function buildOf(object: Drawable, material: Material): string {
  const shared = graphOf(material) ?? material.uuid;
  return `${shared}|${object.type}|${layoutOf(object.geometry)}|${object.receiveShadow}`;
}

/**
 * A row for each build under `roots`, as `view` draws them. Each is one
 * read in the compiles' turn; the scene keeps drawing meanwhile.
 */
export async function pipelineBudget(
  scene: {
    renderer: object;
    roots: Object3D[];
    shadersOf: PostStack["shadersOf"];
    view: Camera;
  },
  query: PipelineBudgetQuery = {}
): Promise<PipelineBudget> {
  const limits = deviceLimits(scene.renderer);
  const report: PipelineBudget = { limits, rows: [], unread: 0 };
  if (!pocEnabled) {
    return report;
  }
  const camera = (scene.view as { isOrthographicCamera?: boolean })
    .isOrthographicCamera
    ? "parallel"
    : "perspective";
  const seen = new Set<string>();
  for (const object of compileRepresentatives(scene.roots) as Drawable[]) {
    const { material } = object;
    if (!material || Array.isArray(material)) {
      report.unread += 1;
      continue;
    }
    const build = buildOf(object, material);
    if (seen.has(build)) {
      continue;
    }
    seen.add(build);
    const shaders = await scene.shadersOf(object, scene.view);
    if (!(shaders?.vertexShader && shaders.fragmentShader)) {
      report.unread += 1;
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
