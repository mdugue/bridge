import { expect, test } from "bun:test";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  Raycaster,
  TorusKnotGeometry,
  Vector3,
} from "three/webgpu";
import { MeshBVH } from "three-mesh-bvh";
// three-mesh-bvh's wiring (computeBoundsTree, the accelerated raycast)
import "./collision";
import {
  arraysLent,
  type BvhOutcome,
  createBvhWorker,
  startSpawnBvh,
  type WorkerLike,
} from "./city-bvh";
import {
  type BvhJob,
  type BvhReply,
  buildJob,
  replyTransfer,
} from "./city-bvh-job";
import { ensureCityBvh } from "./city-layer";

/** The positions' quantisation range (m): the node's scale, outside. */
const RANGE = 16;

/**
 * A building tile's layout (scripts/tile-glb.ts as GLTFLoader reads it):
 * int16 positions, `normalized`, interleaved at a stride of four (the
 * glTF's byteStride of 8), a Uint32 index, the feature ids in a buffer of
 * their own. A torus knot: ~13 k triangles in every direction.
 */
function quantisedTile(): BufferGeometry {
  const knot = new TorusKnotGeometry(10, 3, 200, 32);
  const source = knot.getAttribute("position");
  const array = new Int16Array(source.count * 4);
  for (let i = 0; i < source.count; i++) {
    array[i * 4] = Math.round((source.getX(i) / RANGE) * 32767);
    array[i * 4 + 1] = Math.round((source.getY(i) / RANGE) * 32767);
    array[i * 4 + 2] = Math.round((source.getZ(i) / RANGE) * 32767);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new InterleavedBufferAttribute(new InterleavedBuffer(array, 4), 3, 0, true)
  );
  geometry.setIndex(
    new BufferAttribute(Uint32Array.from(knot.getIndex()?.array ?? []), 1)
  );
  geometry.setAttribute(
    "featureId",
    new BufferAttribute(new Float32Array(source.count), 1)
  );
  return geometry;
}

/** A tile's mesh: the dequantisation on the node, as the glTF has it. */
function meshOf(geometry: BufferGeometry): Mesh {
  const mesh = new Mesh(geometry, new MeshBasicNodeMaterial());
  mesh.scale.setScalar(RANGE);
  mesh.position.set(5, 152, -3);
  mesh.updateMatrixWorld(true);
  return mesh;
}

type Listener = (event: MessageEvent) => void;

/**
 * A worker in this thread. Every message goes through a structured clone
 * with its transfer list — the arrays lent are detached on this side, as
 * a real worker's are — and the job module answers it once `answer()` is
 * called (`answerWith` may change the reply first).
 */
class InThreadWorker implements WorkerLike {
  private readonly listeners = new Map<string, Listener[]>();
  private readonly held: BvhJob[] = [];
  terminated = false;

  constructor(
    loads = true,
    private readonly answerWith: (reply: BvhReply) => BvhReply = (r) => r
  ) {
    setTimeout(() => {
      if (loads) {
        this.emit("message", { ready: true });
      } else {
        this.emit("error", {});
      }
    }, 0);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.held.push(structuredClone(message, { transfer }) as BvhJob);
  }

  terminate(): void {
    this.terminated = true;
  }

  get holding(): number {
    return this.held.length;
  }

  /** answers every job taken so far */
  answer(): void {
    for (const job of this.held.splice(0)) {
      const reply = this.answerWith(buildJob(job));
      this.emit(
        "message",
        structuredClone(reply, { transfer: replyTransfer(reply) })
      );
    }
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

/** Until the worker has taken a job (its post comes after `ready`). */
async function taken(worker: InThreadWorker): Promise<void> {
  while (worker.holding === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const bytes = (geometry: BufferGeometry) =>
  MeshBVH.serialize(geometry.boundsTree as MeshBVH, {
    cloneBuffers: false,
  }).roots.map((root) => new Uint8Array(root));

test("the worker's BVH over quantised, interleaved positions is the one computeBoundsTree builds", async () => {
  const here = quantisedTile();
  here.computeBoundsTree();
  const there = quantisedTile();
  const fake = new InThreadWorker();
  const worker = createBvhWorker(() => fake);
  const built = worker.build(there, "knot");
  await taken(fake);
  fake.answer();
  expect(await built).toBe("built");

  // the same nodes, byte for byte, over the same sorted index
  expect(bytes(there)).toEqual(bytes(here));
  expect(there.getIndex()?.array).toEqual(here.getIndex()?.array);
  // in the positions' normalized frame (±1), as the main thread reads them:
  // a worker that took the int16 as they are would put it at ±32767
  const box = (there.boundsTree as MeshBVH).getBoundingBox(new Box3());
  expect(box).toEqual((here.boundsTree as MeshBVH).getBoundingBox(new Box3()));
  expect(box.max.x).toBeGreaterThan(0.5);
  expect(box.max.x).toBeLessThanOrEqual(1);

  // and the collider's rays hit the same faces at the same places
  const a = meshOf(here);
  const b = meshOf(there);
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  let hits = 0;
  for (let i = 0; i < 64; i++) {
    // from all around at 400 m, towards a point on the knot's ring (it
    // lies in the node's xy plane, radius 10)
    const angle = (i / 64) * Math.PI * 2;
    const origin = new Vector3(
      5 + Math.cos(angle) * 400,
      152 + ((i % 8) - 4) * 20,
      -3 + Math.sin(angle) * 400
    );
    const onRing = i * 2.39996;
    const toward = new Vector3(
      5 + Math.cos(onRing) * 10,
      152 + Math.sin(onRing) * 10,
      -3
    );
    raycaster.set(origin, toward.sub(origin).normalize());
    const hitA = raycaster.intersectObject(a, false)[0];
    const hitB = raycaster.intersectObject(b, false)[0];
    expect(hitB?.distance).toBe(hitA?.distance);
    expect(hitB?.faceIndex).toBe(hitA?.faceIndex);
    expect(hitB?.face?.a).toBe(hitA?.face?.a);
    hits += hitA ? 1 : 0;
  }
  expect(hits).toBeGreaterThan(32);
});

test("while the arrays are lent, nothing builds over them; a geometry disposed meanwhile gets them back and no BVH", async () => {
  const geometry = quantisedTile();
  const mesh = meshOf(geometry);
  const fake = new InThreadWorker();
  const worker = createBvhWorker(() => fake);
  const built = worker.build(geometry);
  await taken(fake);

  expect(arraysLent(geometry)).toBe(true);
  // moved, not copied: empty here
  expect(geometry.getIndex()?.array.length).toBe(0);
  expect(
    (geometry.getAttribute("position") as InterleavedBufferAttribute).data.array
      .length
  ).toBe(0);
  // the bounds the frustum and the rays need were taken before the loan
  expect(geometry.boundingSphere?.radius).toBeGreaterThan(0.5);
  expect(geometry.boundingBox?.isEmpty()).toBe(false);
  // a ray that reaches the tile builds nothing over the empty arrays
  ensureCityBvh(mesh);
  expect(geometry.boundsTree).toBeUndefined();

  geometry.dispose();
  fake.answer();
  expect(await built).toBe("dropped");
  expect(geometry.boundsTree).toBeUndefined();
  expect(arraysLent(geometry)).toBe(false);
  expect(geometry.getIndex()?.array.length).toBeGreaterThan(0);
});

test("no worker, one that fails to load or fails the build: the arrays stay or come back, for the main thread to build", async () => {
  for (const spawn of [
    () => null,
    () => {
      throw new Error("no workers here");
    },
    () => new InThreadWorker(false),
  ]) {
    const geometry = quantisedTile();
    const worker = createBvhWorker(spawn);
    expect(await worker.ready).toBe(false);
    expect(await worker.build(geometry)).toBe("refused");
    expect(arraysLent(geometry)).toBe(false);
    expect(geometry.getIndex()?.array.length).toBeGreaterThan(0);
  }

  const geometry = quantisedTile();
  const fake = new InThreadWorker(true, (reply) => ({
    ...reply,
    serialized: undefined,
    error: "out of memory",
  }));
  const built = createBvhWorker(() => fake).build(geometry);
  await taken(fake);
  fake.answer();
  expect(await built).toBe("failed");
  expect(arraysLent(geometry)).toBe(false);
  // ...and the main thread builds it as it would have
  geometry.computeBoundsTree();
  const here = quantisedTile();
  here.computeBoundsTree();
  expect(bytes(geometry)).toEqual(bytes(here));
});

test("a worker that goes with the arrays leaves the geometry without them, never with a BVH over empty ones", async () => {
  for (const end of [
    (fake: InThreadWorker) => fake.emit("error", {}),
    (_fake: InThreadWorker, worker: { dispose: () => void }) =>
      worker.dispose(),
  ]) {
    const geometry = quantisedTile();
    const mesh = meshOf(geometry);
    const fake = new InThreadWorker();
    const worker = createBvhWorker(() => fake);
    const built = worker.build(geometry);
    await taken(fake);
    end(fake, worker);
    expect(await built).toBe("lost");
    expect(fake.terminated).toBe(true);
    expect(arraysLent(geometry)).toBe(true);
    ensureCityBvh(mesh);
    expect(geometry.boundsTree).toBeUndefined();
    // the worker is gone: what comes next is refused, not lost
    expect(await worker.build(quantisedTile())).toBe("refused");
  }
});

test("a job that cannot be built answers with its arrays and why", () => {
  const geometry = quantisedTile();
  const index = geometry.getIndex()?.array as Uint32Array;
  const job: BvhJob = {
    id: 7,
    position: {
      // no array at all: the geometry cannot even be made
      array: null as never,
      itemSize: 3,
      normalized: true,
      stride: 4,
      offset: 0,
    },
    index,
    drawRange: { start: 0, count: Number.POSITIVE_INFINITY },
    groups: [],
  };
  const reply = buildJob(job);
  expect(reply.id).toBe(7);
  expect(reply.serialized).toBeUndefined();
  expect(reply.error).toBeString();
  expect(reply.index).toBe(index);
});

/** A promise and what settles it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the spawn tile's build starts once its buffers are uploaded and the worker has loaded, and the boot waits for it", async () => {
  const uploaded = deferred<boolean>();
  const ready = deferred<boolean>();
  const outcome = deferred<BvhOutcome>();
  let builds = 0;
  const spawn = startSpawnBvh(uploaded.promise, ready.promise, () => {
    builds++;
    return outcome.promise;
  });
  ready.resolve(true);
  await tick();
  expect(builds).toBe(0);
  uploaded.resolve(true);
  await tick();
  expect(builds).toBe(1);
  const settled = spawn.settle();
  outcome.resolve("built");
  expect(await settled).toBe("built");
});

test("the boot asks first, or the buffers or the worker never come: it skips, and nothing is lent after", async () => {
  const cases: (() => [Promise<boolean>, Promise<boolean>])[] = [
    () => [Promise.resolve(false), Promise.resolve(true)],
    () => [Promise.resolve(true), Promise.resolve(false)],
    () => [Promise.reject(new Error("compile")), Promise.resolve(true)],
  ];
  for (const promises of cases) {
    let builds = 0;
    const spawn = startSpawnBvh(...promises(), () => {
      builds++;
      return Promise.resolve("built");
    });
    await tick();
    expect(await spawn.settle()).toBe("skipped");
    expect(builds).toBe(0);
  }
  // asked before the upload: skipped, and the upload that comes later
  // lends nothing
  const uploaded = deferred<boolean>();
  let builds = 0;
  const spawn = startSpawnBvh(uploaded.promise, Promise.resolve(true), () => {
    builds++;
    return Promise.resolve("built");
  });
  expect(await spawn.settle()).toBe("skipped");
  uploaded.resolve(true);
  await tick();
  expect(builds).toBe(0);
  // a build that throws settles as failed (the main thread builds it)
  const throwing = startSpawnBvh(
    Promise.resolve(true),
    Promise.resolve(true),
    () => Promise.reject(new Error("deserialize"))
  );
  await tick();
  expect(await throwing.settle()).toBe("failed");
});
