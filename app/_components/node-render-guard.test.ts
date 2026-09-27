import { expect, spyOn, test } from "bun:test";
import { Object3D } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { guardNodeRenderer } from "./node-render-guard";

interface FakeRenderObject {
  /** null until looked up, as three's RenderObject starts it */
  _nodeBuilderState: unknown;
  initialCacheKey: number;
  material: unknown;
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
        ro = {
          _nodeBuilderState: null,
          initialCacheKey: object.id,
          material: object.userData.material,
        };
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
  _handleObjectFunction:
    | ((object: Object3D, material: unknown) => void)
    | null = null;
  constructor(private readonly buildMs: number) {}

  _renderObjectDirect(object: Object3D): void {
    const ro = this._objects.get(object);
    const cache = this._nodes.nodeBuilderCache;
    if (!(ro._nodeBuilderState || cache.has(ro.initialCacheKey))) {
      this.clock += this.buildMs;
      cache.set(ro.initialCacheKey, {});
    }
    ro._nodeBuilderState = cache.get(ro.initialCacheKey);
    this._pipelines.updateForRender(ro);
    this.drawn.push(object.name);
    // a pass that renders inside this draw (the shadow map, a scene pass)
    for (const child of (object.userData.nested ?? []) as Object3D[]) {
      this.draw(child);
    }
  }

  /** what three's render list does for each object */
  draw(object: Object3D): void {
    this._handleObjectFunction?.call(this, object, object.userData.material);
  }
}

function install(fake: FakeRenderer, onLate: () => void) {
  return guardNodeRenderer(fake as unknown as WebGPURenderer, onLate);
}

function named(name: string, userData: Record<string, unknown> = {}) {
  const o = new Object3D();
  o.name = name;
  o.userData = userData;
  return o;
}

const SHADOW = { isShadowPassMaterial: true };

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
    const objects = ["a", "b", "c", "d"].map((n) => named(n));
    guard.beginFrame();
    for (const o of objects) {
      fake.draw(o);
    }
    guard.endFrame();
    // 4 ms each against a 6 ms budget: two build, two wait.
    expect(fake.drawn).toEqual(["a", "b"]);
    guard.beginFrame(); // main-pass objects are drawn next frame anyway
    expect(late).toBe(0);
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
  fake.draw(named("main"));
  fake.draw(named("caster", { material: SHADOW }));
  guard.endFrame();
  // A one-off render (the land-cover paint) draws at once, blocking.
  fake.draw(named("out"));
  expect(fake.pipelineCalls).toEqual(["async", "async", "sync"]);
  await Promise.all(fake.pending);
  await Promise.resolve();
  // Only the shadow pass's pipeline asks for a redraw: the main pass is
  // drawn every frame anyway.
  expect(late).toBe(1);
});

test("a caster held back by the budget asks for a shadow redraw", () => {
  const fake = new FakeRenderer(4);
  let late = 0;
  const now = spyOn(performance, "now").mockImplementation(() => fake.clock);
  try {
    const guard = install(fake, () => late++);
    guard.beginFrame();
    for (const name of ["a", "b", "c"]) {
      fake.draw(named(name, { material: SHADOW }));
    }
    guard.endFrame();
    expect(fake.drawn).toEqual(["a", "b"]);
    guard.beginFrame();
    guard.endFrame();
    expect(late).toBe(1);
  } finally {
    now.mockRestore();
  }
});

test("a draw is charged its own build, not the passes inside it", () => {
  const fake = new FakeRenderer(1.5);
  const now = spyOn(performance, "now").mockImplementation(() => fake.clock);
  try {
    const guard = install(fake, () => undefined);
    // The output quad (new) renders the scene pass (two new objects) inside
    // its own draw; then two more objects are met.
    const quad = named("quad", { nested: [named("s1"), named("s2")] });
    (quad as Object3D & { isQuadMesh: boolean }).isQuadMesh = true;
    guard.beginFrame();
    fake.draw(quad);
    fake.draw(named("late1"));
    fake.draw(named("late2"));
    guard.endFrame();
    // Charged 1.5 × 3 = 4.5 so far, so late1 still builds (6), late2
    // waits. Charging the quad its children's time too (4.5 + 3) would
    // have held late1 back.
    expect(fake.drawn).toEqual(["quad", "s1", "s2", "late1"]);
  } finally {
    now.mockRestore();
  }
});

test("full-screen quads are never held back", () => {
  const fake = new FakeRenderer(10);
  const now = spyOn(performance, "now").mockImplementation(() => fake.clock);
  try {
    const guard = install(fake, () => undefined);
    const quads = ["q1", "q2"].map((n) => {
      const q = named(n) as Object3D & { isQuadMesh: boolean };
      q.isQuadMesh = true;
      return q;
    });
    guard.beginFrame();
    for (const q of quads) {
      fake.draw(q);
    }
    guard.endFrame();
    expect(fake.drawn).toEqual(["q1", "q2"]);
  } finally {
    now.mockRestore();
  }
});
