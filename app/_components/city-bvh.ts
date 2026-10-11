import type {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
} from "three/webgpu";
import { MeshBVH } from "three-mesh-bvh";
import type { BvhJob, BvhReply } from "./city-bvh-job";
import { streamTimings } from "./stream-timing";
import { boundsNow, bufferOf } from "./three-utils";

/**
 * The spawn tile's BVH off the main thread (plans 043, 069): one worker
 * per boot (city-bvh.worker.ts, the job in city-bvh-job.ts) that the
 * geometry's position and index arrays are lent to — transferred, not
 * copied: forty megabytes of a dense tile — and that hands them back with
 * the BVH's nodes. While they are away the arrays on this side are
 * detached (empty):
 * the GPU draws from its own copy, uploaded before the loan (the city's
 * compile), and nothing on the CPU may read them — `arraysLent` is what the
 * BVH's builders (city-layer.ts `ensureCityBvh`, the demolish) ask first.
 */

/** Geometries whose positions and index the worker holds (or went with). */
const lent = new WeakSet<BufferGeometry>();

/** Whether `geometry`'s positions and index are lent to the BVH worker:
 *  read now, they are empty, and a BVH built over them would hold nothing. */
export function arraysLent(geometry: BufferGeometry): boolean {
  return lent.has(geometry);
}

/** What became of a build in the worker. */
export type BvhOutcome =
  /** the BVH is on the geometry, the arrays back */
  | "built"
  /** not sent (no worker, one that failed to load or went, a layout it
   *  does not take): the arrays never left — build it here */
  | "refused"
  /** sent and answered without a BVH: the arrays are back — build it here */
  | "failed"
  /** the geometry was disposed meanwhile (its tile left): the arrays are
   *  back, the BVH dropped */
  | "dropped"
  /** the worker went with the arrays (it died, or the app was disposed):
   *  the geometry keeps its GPU copy and never gets a BVH */
  | "lost";

export interface BvhWorker {
  /** whether the worker's module has loaded (false: it never will) */
  ready: Promise<boolean>;
  /** builds `geometry`'s BVH there, the default `computeBoundsTree()`
   *  builds (city-bvh-job.ts `buildJob`); `detail` names it on the trace */
  build: (geometry: BufferGeometry, detail?: string) => Promise<BvhOutcome>;
  /** ends the worker; a build in flight is lost */
  dispose: () => void;
}

/** The part of a `Worker` this uses (one in the tests' own thread). */
export interface WorkerLike {
  addEventListener(
    type: "error" | "message" | "messageerror",
    listener: (event: MessageEvent) => void
  ): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

/** The worker, where the page has workers. The `new Worker(new URL(…))`
 *  shape is what the bundler looks for: it builds the worker's own chunk. */
function spawnBvhWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Worker(new URL("./city-bvh.worker.ts", import.meta.url), {
    type: "module",
  });
}

/** The geometry's arrays as a job, or null where it cannot be lent: no
 *  index (three-mesh-bvh would make one), an interleaved index, or a
 *  buffer another attribute views too (lending it would empty that one). */
export function jobOf(geometry: BufferGeometry, id: number): BvhJob | null {
  const position = geometry.getAttribute("position") as
    | BufferAttribute
    | InterleavedBufferAttribute
    | undefined;
  const index = geometry.getIndex();
  if (
    !(position && index) ||
    (index as unknown as InterleavedBufferAttribute)
      .isInterleavedBufferAttribute ||
    !(index.array instanceof Uint32Array || index.array instanceof Uint16Array)
  ) {
    return null;
  }
  const holder = bufferOf(position);
  const buffers = [holder.array.buffer, index.array.buffer];
  if (!buffers.every((b) => b instanceof ArrayBuffer && b.byteLength > 0)) {
    return null;
  }
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (
      name !== "position" &&
      buffers.includes(bufferOf(attribute).array.buffer)
    ) {
      return null;
    }
  }
  const interleaved = (position as InterleavedBufferAttribute)
    .isInterleavedBufferAttribute;
  return {
    id,
    position: {
      array: holder.array,
      itemSize: position.itemSize,
      normalized: position.normalized,
      stride: interleaved
        ? (position as InterleavedBufferAttribute).data.stride
        : 0,
      offset: interleaved ? (position as InterleavedBufferAttribute).offset : 0,
    },
    index: index.array,
    drawRange: { ...geometry.drawRange },
    groups: geometry.groups.map((g) => ({ ...g })),
  };
}

/** Puts the arrays the worker hands back where they were lent from. */
function restore(geometry: BufferGeometry, reply: BvhReply): void {
  const position = geometry.getAttribute("position");
  bufferOf(position).array = reply.position;
  const index = geometry.getIndex();
  if (index) {
    // sorted in place where the build ran, as three-mesh-bvh does here —
    // not marked for upload: the GPU keeps the order it was given, the
    // same triangles
    index.array = reply.index;
  }
}

/**
 * The BVH worker of one boot (`spawn`: the page's worker; a fake one in
 * the tests). A worker that fails to load answers `ready` false and every
 * build "refused"; one that dies with a loan in flight, "lost".
 */
export function createBvhWorker(
  spawn: () => WorkerLike | null = spawnBvhWorker
): BvhWorker {
  let worker: WorkerLike | null = null;
  try {
    worker = spawn();
  } catch {
    worker = null;
  }
  const replies = new Map<number, (reply: BvhReply | null) => void>();
  let nextId = 1;
  let markReady: (ok: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    markReady = resolve;
  });
  /** the worker is gone: nothing more will load or answer */
  const end = () => {
    markReady(false);
    worker?.terminate();
    worker = null;
    for (const settle of replies.values()) {
      settle(null);
    }
    replies.clear();
  };
  if (worker) {
    worker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as BvhReply | { ready: true };
      if ("ready" in data) {
        markReady(true);
        return;
      }
      replies.get(data.id)?.(data);
      replies.delete(data.id);
    });
    worker.addEventListener("error", end);
    worker.addEventListener("messageerror", end);
  } else {
    markReady(false);
  }

  /** Lends the job's arrays: the answer to wait for (null: they went with
   *  the worker), or null where nothing was lent. */
  const lend = (job: BvhJob): Promise<BvhReply | null> | null => {
    const to = worker;
    if (!to) {
      return null;
    }
    const answered = new Promise<BvhReply | null>((resolve) => {
      replies.set(job.id, resolve);
    });
    try {
      to.postMessage(job, [
        ...new Set([job.position.array.buffer, job.index.buffer]),
      ] as ArrayBuffer[]);
    } catch {
      // not cloned, so not moved: the arrays are still here
      replies.delete(job.id);
      return null;
    }
    return answered;
  };

  const build = async (
    geometry: BufferGeometry,
    detail?: string
  ): Promise<BvhOutcome> => {
    if (lent.has(geometry) || !(await ready)) {
      return "refused";
    }
    const job = geometry.boundsTree ? null : jobOf(geometry, nextId++);
    if (!job) {
      return geometry.boundsTree ? "built" : "refused";
    }
    // the bounds the frustum, the collider and the picks take from the
    // positions, while they are here
    boundsNow(geometry);
    const start = streamTimings.now();
    const answered = lend(job);
    if (!answered) {
      return "refused";
    }
    lent.add(geometry);
    let disposed = false;
    const onDispose = () => {
      disposed = true;
    };
    geometry.addEventListener("dispose", onDispose);
    const reply = await answered;
    geometry.removeEventListener("dispose", onDispose);
    if (!reply) {
      return "lost";
    }
    restore(geometry, reply);
    lent.delete(geometry);
    if (disposed) {
      return "dropped";
    }
    if (!reply.serialized) {
      return "failed";
    }
    try {
      geometry.boundsTree = MeshBVH.deserialize(reply.serialized, geometry, {
        setIndex: false,
      });
    } catch {
      return "failed";
    }
    streamTimings.since("tile:bvh-worker", start, detail);
    return "built";
  };

  return { ready, build, dispose: end };
}

/** The spawn tile's build as the boot waits for it (`startSpawnBvh`). */
export interface SpawnBvh {
  /**
   * What became of it, once nothing is left to wait for: the build's
   * outcome where it started, else "skipped" — the city's buffers not
   * uploaded or the worker not loaded by now, and never lent after this
   * (the placing builds it on the main thread, as without a worker).
   */
  settle: () => Promise<BvhOutcome | "skipped">;
}

/**
 * Starts `build` (the spawn tile's BVH in the worker) once the tile's
 * buffers are on the GPU (`uploaded`: its content's compile ended, and
 * with it the upload — an array lent before that would upload empty) and
 * the worker has loaded (`ready`) — unless the boot has asked for it
 * first (`settle`): it then waits for a build already running, and for
 * nothing else.
 */
export function startSpawnBvh(
  uploaded: Promise<boolean>,
  ready: Promise<boolean>,
  build: () => Promise<BvhOutcome>
): SpawnBvh {
  let running: Promise<BvhOutcome> | "waiting" | "skipped" = "waiting";
  void Promise.all([uploaded, ready]).then(
    ([up, loaded]) => {
      if (running === "waiting") {
        running =
          up && loaded ? build().catch((): BvhOutcome => "failed") : "skipped";
      }
    },
    () => {
      running = running === "waiting" ? "skipped" : running;
    }
  );
  return {
    settle: () => {
      if (running === "waiting") {
        running = "skipped";
      }
      return running === "skipped" ? Promise.resolve("skipped") : running;
    },
  };
}
