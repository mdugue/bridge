import { expect, spyOn, test } from "bun:test";
import { Object3D } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { guardNodeRenderer } from "./node-render-guard";

interface FakeRenderObject {
  _nodeBuilderState?: unknown;
  initialCacheKey: number;
}
type Promises = { push: (p: unknown) => void } | null;

/**
 * A stand-in for the WebGPURenderer internals the guard wraps: render
 * objects keyed by object, a node-builder cache, and a pipeline manager that
 * records whether it was asked for a pipeline blocking (null) or async.
 * Its draw builds a missing node state (advancing the clock by `buildMs`),
 * asks for the pipeline and records the draw, as three's does.
 */
class FakeRenderer {
  clock = 0;
  readonly drawn: string[] = [];
  readonly pipelineCalls: ("sync" | "async")[] = [];
  readonly pending: Promise<void>[] = [];
  private readonly renderObjects = new Map<Object3D, FakeRenderObject>();
  readonly _currentRenderContext = {};
  readonly _nodes = { nodeBuilderCache: new Map<number, unknown>() };
  readonly backend = {
    capabilities: { getUniformBufferLimit: () => 65_536 },
  };
  readonly _objects = {
    get: (object: Object3D): FakeRenderObject => {
      let ro = this.renderObjects.get(object);
      if (!ro) {
        ro = { initialCacheKey: object.id };
        this.renderObjects.set(object, ro);
      }
      return ro;
    },
  };
  readonly _pipelines = {
    getForRender: (_ro: unknown, promises: Promises) => {
      this.pipelineCalls.push(promises ? "async" : "sync");
      if (promises) {
        const p = Promise.resolve();
        this.pending.push(p);
        promises.push(p);
      }
    },
    updateForRender: (_ro: unknown): void => undefined,
  };
  _handleObjectFunction: ((object: Object3D) => void) | null = null;
  constructor(private readonly buildMs: number) {}

  _renderObjectDirect(object: Object3D): void {
    const ro = this._objects.get(object);
    const cache = this._nodes.nodeBuilderCache;
    if (!(ro._nodeBuilderState || cache.has(ro.initialCacheKey))) {
      this.clock += this.buildMs;
      cache.set(ro.initialCacheKey, {});
    }
    this._pipelines.updateForRender(ro);
    this.drawn.push(object.name);
  }

  /** what three's render list does for each object */
  draw(object: Object3D): void {
    this._handleObjectFunction?.call(this, object);
  }
}

function install(fake: FakeRenderer, onLate: () => void) {
  return guardNodeRenderer(fake as unknown as WebGPURenderer, onLate);
}

function named(name: string): Object3D {
  const o = new Object3D();
  o.name = name;
  return o;
}

test("instancing no longer depends on the instance count", () => {
  const fake = new FakeRenderer(0);
  install(fake, () => undefined);
  expect(fake.backend.capabilities.getUniformBufferLimit()).toBe(0);
});

test("in a frame, new builds share a budget and the rest wait", () => {
  const fake = new FakeRenderer(4);
  let late = 0;
  const now = spyOn(performance, "now").mockImplementation(() => fake.clock);
  try {
    const guard = install(fake, () => late++);
    const objects = ["a", "b", "c", "d"].map(named);
    guard.beginFrame();
    for (const o of objects) {
      fake.draw(o);
    }
    guard.endFrame();
    // 4 ms each against a 6 ms budget: two build, two wait.
    expect(fake.drawn).toEqual(["a", "b"]);
    guard.beginFrame(); // the skipped ones ask for a shadow redraw
    expect(late).toBe(1);
    fake.drawn.length = 0;
    for (const o of objects) {
      fake.draw(o);
    }
    guard.endFrame();
    // a and b are cached (free); c and d build now
    expect(fake.drawn).toEqual(["a", "b", "c", "d"]);
  } finally {
    now.mockRestore();
  }
});

test("pipelines are async inside a frame and blocking outside it", async () => {
  const fake = new FakeRenderer(0);
  let late = 0;
  const guard = install(fake, () => late++);
  guard.beginFrame();
  fake.draw(named("in"));
  guard.endFrame();
  // A one-off render (the land-cover paint) draws at once, blocking.
  fake.draw(named("out"));
  expect(fake.pipelineCalls).toEqual(["async", "sync"]);
  await Promise.all(fake.pending);
  await Promise.resolve();
  expect(late).toBe(1);
});
