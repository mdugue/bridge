/**
 * SPIKE (plan 020): counts what the node renderer builds and when, so a
 * flight probe (e2e/spike-flight.ts) can tell a stutter's cause apart:
 * a TSL node build (main-thread JavaScript), a new shader module or a
 * render pipeline created synchronously inside a frame (the driver compiles
 * it before the frame can finish). Node builds over 20 ms also leave a
 * performance measure named after the material and object.
 *
 * Dev and e2e builds only (the same switch as poc-debug.ts): the counters
 * land on `window.__gpuStats`.
 */
import type { WebGPURenderer } from "three/webgpu";

export interface GpuStats {
  /** node builds run synchronously (inside a render) / asynchronously */
  syncBuilds: number;
  asyncBuilds: number;
  /** main-thread milliseconds the synchronous builds took */
  syncBuildMs: number;
  /** shader modules created (one per distinct WGSL/GLSL source) */
  programs: number;
  /** render pipelines created blocking / through the async API */
  syncPipelines: number;
  asyncPipelines: number;
}

declare global {
  interface Window {
    __gpuStats?: GpuStats;
  }
}

const enabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_POC_DEBUG === "1";

interface RenderObjectLike {
  initialCacheKey: number;
  material: { name: string; type: string };
  object: { name: string; type: string };
}

// reason: the counters wrap private renderer internals (three 0.186); these
// are the members they touch.
interface ProbedInternals {
  _nodes: {
    get: (ro: RenderObjectLike) => { nodeBuilderState?: unknown };
    getForRender: (ro: RenderObjectLike, useAsync?: boolean) => unknown;
    nodeBuilderCache: Map<number, unknown>;
  };
  backend: {
    createProgram: (program: unknown) => void;
    createRenderPipeline: (ro: unknown, promises: unknown[] | null) => void;
  };
}

export function probeNodeRenderer(renderer: WebGPURenderer): void {
  if (!enabled) {
    return;
  }
  const stats: GpuStats = {
    syncBuilds: 0,
    asyncBuilds: 0,
    syncBuildMs: 0,
    programs: 0,
    syncPipelines: 0,
    asyncPipelines: 0,
  };
  window.__gpuStats = stats;
  const internals = renderer as unknown as ProbedInternals;
  const nodes = internals._nodes;
  const getForRender = nodes.getForRender.bind(nodes);
  nodes.getForRender = (ro, useAsync = false) => {
    const fresh =
      nodes.get(ro).nodeBuilderState === undefined &&
      !nodes.nodeBuilderCache.has(ro.initialCacheKey);
    const start = performance.now();
    const done = <T>(value: T): T => {
      const duration = performance.now() - start;
      if (fresh && duration > 20) {
        performance.measure(
          `${useAsync ? "async" : "sync"}:${ro.material.type}:${ro.object.name || ro.object.type}`,
          { start, duration }
        );
      }
      return value;
    };
    const result = getForRender(ro, useAsync);
    if (result instanceof Promise) {
      stats.asyncBuilds += fresh ? 1 : 0;
      return result.then(done);
    }
    if (fresh) {
      stats.syncBuilds += 1;
      stats.syncBuildMs += performance.now() - start;
    }
    return done(result);
  };
  const backend = internals.backend;
  const createProgram = backend.createProgram.bind(backend);
  backend.createProgram = (program) => {
    stats.programs += 1;
    createProgram(program);
  };
  const createPipeline = backend.createRenderPipeline.bind(backend);
  backend.createRenderPipeline = (ro, promises) => {
    if (promises) {
      stats.asyncPipelines += 1;
    } else {
      stats.syncPipelines += 1;
    }
    createPipeline(ro, promises);
  };
}
