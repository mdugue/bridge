import type {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
} from "three/webgpu";
import { MeshBVH } from "three-mesh-bvh";
import { whenIdle } from "./main-yield";
import { createWorkerClient } from "./worker-client";

/**
 * A building tile's BVH built in the BVH worker (bvh-worker.ts) instead of
 * inside a frame: three-mesh-bvh's build took a dense tile 0.2 s on a
 * desktop and 0.8–1.6 s on the phone profile (CPU ×4), the longest stall
 * of a flight once the ground had left the main thread. One worker for the
 * page, one tile at a time — the build's scratch (six floats a triangle)
 * is one tile's at most, on the worker's heap instead of the page's.
 *
 * The tile's positions and index are handed over, not copied (a dense
 * tile's are 35 MB, and a phone's memory must not grow), so for the
 * build's length the geometry has no CPU copy of them: `bvhBuilding` says
 * so, and every reader on the CPU (the collider's rays, picks, a demolish)
 * waits or passes the tile over until they are back. The GPU draws from
 * its own buffers all along. The build sorts the index in place, as on
 * the main thread: the GPU keeps the order it was given, the same
 * triangles. A tile whose arrays share a buffer with anything else is
 * built here (handed over, the other would go with them; copied, the
 * page's memory would grow). The line, the handshake and what follows a
 * dead worker are the one rule of the page's workers (worker-client.ts).
 */
export interface BvhJob {
  position: {
    array: PositionArray;
    itemSize: number;
    stride: number;
    offset: number;
    normalized: boolean;
  };
  index: IndexArray;
  groups: { start: number; count: number; materialIndex?: number }[];
  drawRange: { start: number; count: number };
}

export interface BvhReply {
  roots?: ArrayBuffer[];
  error?: string;
  index: IndexArray;
  position: PositionArray;
}

type IndexArray = Uint16Array | Uint32Array;
type PositionArray =
  | Float32Array
  | Int16Array
  | Int8Array
  | Uint16Array
  | Uint8Array;

const building = new WeakSet<BufferGeometry>();
/** geometries whose arrays a dying worker took with it: drawn, never
 *  raycast again (treated as still building) */
const lost = new WeakSet<BufferGeometry>();
/** How long a build here, where the worker cannot, waits for an idle
 *  scene thread at most (ms; `whenIdle`). */
const IDLE_BUILD_MS = 1000;

/** Whether `geometry`'s BVH is being built off the thread (its positions
 *  and index are away). */
export function bvhBuilding(geometry: BufferGeometry): boolean {
  return building.has(geometry) || lost.has(geometry);
}

/** Whether a worker died with `geometry`'s positions and index: the tile
 *  draws, but nothing on the CPU can read it again (a demolish neither). */
export function bvhLost(geometry: BufferGeometry): boolean {
  return lost.has(geometry);
}

/** Whether the BVH worker is up (a test asks: the fallback builds alike). */
export function bvhWorkerUp(): boolean {
  return client.up();
}

/**
 * Stops the worker before the page reloads (create-app.ts `stopWorkers`,
 * once the stream is gone): the building tiles' arrays in its heap go
 * now, not when the old document is collected. A build still away
 * settles as lost (its tile went with the scene); a later build starts a
 * new worker.
 */
export function stopBvhWorker(): void {
  client.stop();
}

/** Whether a typed array is all of its buffer (can be handed over). */
const ownsBuffer = (a: ArrayBufferView): boolean =>
  a.byteOffset === 0 && a.byteLength === a.buffer.byteLength;

interface Taken {
  job: BvhJob;
  /** puts the arrays that came back where they were */
  restore: (reply: Pick<BvhReply, "index" | "position">) => void;
  transfer: Transferable[];
}

/** The geometry's positions and index for the worker, and how to put the
 *  ones that come back in their place. */
function take(geometry: BufferGeometry): Taken | null {
  const position = geometry.getAttribute("position");
  const indexAttr = geometry.getIndex();
  if (!indexAttr) {
    return null;
  }
  const interleaved = (position as InterleavedBufferAttribute)
    .isInterleavedBufferAttribute;
  const source = (
    interleaved
      ? (position as InterleavedBufferAttribute).data.array
      : (position as BufferAttribute).array
  ) as PositionArray;
  const index = indexAttr.array as IndexArray;
  // an array that shares its buffer could only go as a copy: the page's
  // memory would grow by it, so that tile is built here, as before
  if (
    !(ownsBuffer(source) && ownsBuffer(index)) ||
    source.buffer === index.buffer
  ) {
    return null;
  }
  // what reads the positions for the tile's bounds reads them now: a box
  // first asked while they are away would come out NaN (and every ray
  // would miss the tile's box)
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }
  const restore = (reply: Pick<BvhReply, "index" | "position">) => {
    if (interleaved) {
      (position as InterleavedBufferAttribute).data.array = reply.position;
    } else {
      (position as BufferAttribute).array = reply.position;
    }
    indexAttr.array = reply.index;
  };
  return {
    job: {
      position: {
        array: source,
        itemSize: position.itemSize,
        stride: interleaved
          ? (position as InterleavedBufferAttribute).data.stride
          : position.itemSize,
        offset: interleaved
          ? (position as InterleavedBufferAttribute).offset
          : 0,
        normalized: position.normalized,
      },
      index,
      groups: geometry.groups.map((g) => ({ ...g })),
      drawRange: { ...geometry.drawRange },
    },
    restore,
    transfer: [source.buffer, index.buffer].filter(
      (b): b is ArrayBuffer => b instanceof ArrayBuffer
    ),
  };
}

/** One tile's build: its geometry, and its arrays while they are away. */
interface Build {
  geometry: BufferGeometry;
  wanted: () => boolean;
  taken?: Taken;
}

/** Whether the build still has a point: no BVH yet, the tile still there. */
const due = (build: Build): boolean =>
  !build.geometry.boundsTree && build.wanted();

/** (a build's result: whether the worker did it) */
const client = createWorkerClient<Build, BvhReply, boolean>({
  name: "BVH",
  start: () =>
    new Worker(new URL("./bvh-worker.ts", import.meta.url), {
      type: "module",
      name: "bvh",
    }),
  // a tile that left before its turn is not built; one whose arrays cannot
  // be handed over is built here
  pack: (build) => {
    const taken = due(build) ? take(build.geometry) : null;
    if (!taken) {
      return null;
    }
    build.taken = taken;
    building.add(build.geometry);
    return { message: taken.job, transfer: taken.transfer, kept: false };
  },
  unsent: (build) => {
    // (the arrays never left)
    build.taken = undefined;
    building.delete(build.geometry);
  },
  unpack: (reply, build) => {
    const { geometry } = build;
    build.taken?.restore(reply);
    build.taken = undefined;
    building.delete(geometry);
    // a build that failed there leaves the tile without a BVH (a ray then
    // builds it on the main thread); a tile that left meanwhile gets none:
    // nothing would ray it
    if (!(reply.roots && due(build))) {
      return true;
    }
    const index = geometry.getIndex()?.array as IndexArray;
    // (`version` is read, though the types leave it out: without it the
    // nodes would be "fixed up" from the old format)
    const data = {
      version: 1,
      roots: reply.roots,
      index,
      indirectBuffer: null,
    };
    geometry.boundsTree = MeshBVH.deserialize(data, geometry, {
      setIndex: false,
    });
    return true;
  },
  // here after all, in idle time where the thread has some
  here: async (build) => {
    if (!due(build)) {
      return false;
    }
    await new Promise<void>((resolve) => {
      whenIdle(() => {
        if (due(build)) {
          build.geometry.computeBoundsTree();
        }
        resolve();
      }, IDLE_BUILD_MS);
    });
    return false;
  },
});

/**
 * Builds `geometry`'s BVH in the worker, after the builds before it;
 * where there is no worker (or it failed), here. Resolves once the
 * geometry has its BVH back (or the build failed: a ray then builds it on
 * the main thread as before). `wanted` says whether the tile is still
 * there: one that left before its turn is not built, and one that left
 * during it gets its arrays back but no BVH. Rejects when the worker ended
 * with the tile's arrays (`bvhLost`).
 */
export async function buildBvhOffThread(
  geometry: BufferGeometry,
  wanted: () => boolean = () => true
): Promise<void> {
  const build: Build = { geometry, wanted };
  try {
    await client.run(build);
  } catch (error) {
    if (build.taken) {
      // the worker ended with the arrays: nothing to restore them from
      // (the GPU still draws the tile; no ray will read it)
      build.taken = undefined;
      building.delete(geometry);
      lost.add(geometry);
      throw new Error("BVH worker lost a tile's buffers", { cause: error });
    }
    throw error;
  }
}
