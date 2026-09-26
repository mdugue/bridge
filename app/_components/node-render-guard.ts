/**
 * Keeps shader work out of the frame on the node renderer (WebGPURenderer,
 * ?gpu=webgpu|webgl2). A tile that streams in brings hundreds of objects —
 * a vegetation cell is three InstancedMeshes, lamps and monuments more —
 * and three 0.186 prepares each one lazily, inside the first frame that
 * draws it:
 *
 * - **Instanced WGSL depended on the instance count.** Under the uniform
 *   buffer limit three reads `instanceMatrix` from a uniform array whose
 *   length is written into the shader (`array<mat4x4f, N>`, Instance.js), so
 *   every cell with a new tree count was a new shader module and a new
 *   render pipeline — compiled by the driver before that frame could show.
 *   Flying into unseen parts of the city met dozens at once: the long,
 *   first-time-only stalls. Reporting a uniform buffer limit of 0 sends
 *   every instanced mesh down three's other path, instance attributes, whose
 *   code is the same for any count (the WebGL renderer's path too).
 * - **Render pipelines were created blocking.** Every pipeline now goes
 *   through the async API (`createRenderPipelineAsync`, or
 *   KHR_parallel_shader_compile on WebGL2); an object whose pipeline is
 *   still compiling is skipped by the renderer (`Pipelines.isReady`) and
 *   drawn from the frame it is ready, and the shadow map is redrawn then.
 * - **Node builds (TSL → WGSL) run on the main thread.** three keys an
 *   instanced mesh's build by its uuid, so each cell is its own build, in
 *   the main pass and again in the shadow pass. Tiles compile ahead of time
 *   (PostStack.compile); whatever still needs a build inside a frame gets a
 *   per-frame budget, and past it waits for the next frame.
 *
 * Built on renderer internals (`_renderObjectDirect`, `_objects`, `_nodes`,
 * `_pipelines`, `backend.capabilities`); three is pinned exactly, and a
 * bump has to re-check them.
 */
import type { Object3D } from "three";
import type { WebGPURenderer } from "three/webgpu";

/** Main-thread time a frame may spend on node builds before the rest wait. */
const BUILD_BUDGET_MS = 6;

export interface NodeRenderGuard {
  /** Opens a frame: its build budget starts, and until `endFrame` objects
   *  may wait for their pipeline or their build. */
  beginFrame(): void;
  /** Closes the frame. Renders outside a frame (a raster painted once, a
   *  compile) prepare everything they draw on the spot: they draw once. */
  endFrame(): void;
}

interface RenderObjectLike {
  _nodeBuilderState?: unknown;
  initialCacheKey: number;
}

type RenderObjectArgs = [
  object: Object3D,
  material: unknown,
  scene: unknown,
  camera: unknown,
  lightsNode: unknown,
  group: unknown,
  clippingContext: unknown,
  passId?: string,
];

// reason: the guard reaches into three's private renderer state; these are
// the members it touches, typed as loosely as three leaves them.
interface RendererInternals {
  _currentRenderContext: unknown;
  _handleObjectFunction: (...args: RenderObjectArgs) => void;
  _renderObjectDirect: (...args: RenderObjectArgs) => void;
  _objects: {
    get: (
      object: Object3D,
      material: unknown,
      scene: unknown,
      camera: unknown,
      lightsNode: unknown,
      renderContext: unknown,
      clippingContext: unknown,
      passId?: string
    ) => RenderObjectLike;
  };
  _nodes: { nodeBuilderCache: Map<number, unknown> };
  _pipelines: {
    getForRender: (
      ro: unknown,
      promises: { push: (p: unknown) => void } | null
    ) => unknown;
    updateForRender: (ro: unknown) => void;
  };
  backend: { capabilities: { getUniformBufferLimit: () => number } };
}

/**
 * Installs the guard. `onLate` runs when an object skipped by a frame —
 * waiting on its pipeline or on the build budget — can be drawn: the sun's
 * shadow map is not redrawn every frame and must catch up with it.
 */
export function guardNodeRenderer(
  renderer: WebGPURenderer,
  onLate: () => void
): NodeRenderGuard {
  const r = renderer as unknown as RendererInternals;

  // Count-independent instancing (see above). Only Instance.js, Skinning.js
  // and RangeNode.js read this limit; nothing here skins or uses ranges.
  r.backend.capabilities.getUniformBufferLimit = () => 0;

  // Every pipeline through the async API. The descriptor is read from the
  // render object synchronously, so a shadow-pass override material (whose
  // nodes three swaps per object) is captured correctly.
  const pipelines = r._pipelines;
  const sink = {
    push: (p: unknown) => {
      (p as Promise<void>).then(onLate, onLate);
    },
  };
  let inFrame = false;
  pipelines.updateForRender = (ro) => {
    pipelines.getForRender(ro, inFrame ? sink : null);
  };

  // Node builds under a per-frame budget. A build is needed when neither
  // the render object nor the cache holds its node state; a cache hit costs
  // microseconds and always goes through.
  let spent = 0;
  let late = false;
  const direct = r._renderObjectDirect;
  r._renderObjectDirect = function (this: RendererInternals, ...args) {
    const [object, material, scene, camera, lightsNode, , clipping, passId] =
      args;
    if (!inFrame) {
      direct.apply(this, args);
      return;
    }
    const ro = this._objects.get(
      object,
      material,
      scene,
      camera,
      lightsNode,
      this._currentRenderContext,
      clipping,
      passId
    );
    if (
      ro._nodeBuilderState !== undefined ||
      this._nodes.nodeBuilderCache.has(ro.initialCacheKey)
    ) {
      direct.apply(this, args);
      return;
    }
    if (spent >= BUILD_BUDGET_MS) {
      late = true;
      return;
    }
    const start = performance.now();
    direct.apply(this, args);
    spent += performance.now() - start;
  };
  // The constructor bound the original; every scene render re-reads it.
  r._handleObjectFunction = r._renderObjectDirect;

  return {
    beginFrame: () => {
      inFrame = true;
      spent = 0;
      if (late) {
        late = false;
        onLate();
      }
    },
    endFrame: () => {
      inFrame = false;
    },
  };
}
