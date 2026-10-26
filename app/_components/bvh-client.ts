import type {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
} from "three/webgpu";
import { MeshBVH } from "three-mesh-bvh";

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
 * triangles. An array that shares its buffer with something else is
 * copied, not handed over.
 */
export interface BvhJob {
  id: number;
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
  id: number;
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

let worker: Worker | null = null;
let broken = typeof Worker === "undefined";
let nextId = 0;
const building = new WeakSet<BufferGeometry>();
/** geometries whose arrays a dying worker took with it: drawn, never
 *  raycast again (treated as still building) */
const lost = new WeakSet<BufferGeometry>();
const settles = new Map<number, (reply: BvhReply | null) => void>();
/** one build at a time: the next waits for this one */
let chain: Promise<unknown> = Promise.resolve();

/** Whether `geometry`'s BVH is being built off the thread (its positions
 *  and index are away). */
export function bvhBuilding(geometry: BufferGeometry): boolean {
  return building.has(geometry) || lost.has(geometry);
}

/** Whether the BVH worker is up (a test asks: the fallback builds alike). */
export function bvhWorkerUp(): boolean {
  return worker !== null && !broken;
}

function startWorker(): Worker | null {
  if (worker || broken) {
    return worker;
  }
  try {
    worker = new Worker(new URL("./bvh-worker.ts", import.meta.url), {
      type: "module",
      name: "bvh",
    });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = ({ data }: MessageEvent<BvhReply>) => {
    const settle = settles.get(data.id);
    settles.delete(data.id);
    settle?.(data);
  };
  // the arrays of a reply that cannot be read are lost: so is the worker
  worker.onmessageerror = () => dieOut();
  worker.onerror = (event) => {
    event.preventDefault();
    dieOut();
  };
  return worker;
}

function dieOut(): void {
  broken = true;
  worker?.terminate();
  worker = null;
  for (const [id, settle] of settles) {
    settles.delete(id);
    settle(null);
  }
}

/** Whether a typed array is all of its buffer (can be handed over). */
const ownsBuffer = (a: ArrayBufferView): boolean =>
  a.byteOffset === 0 && a.byteLength === a.buffer.byteLength;

interface Taken {
  job: Omit<BvhJob, "id">;
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
  const interleaved =
    (position as InterleavedBufferAttribute).isInterleavedBufferAttribute ===
    true;
  const source = (
    interleaved
      ? (position as InterleavedBufferAttribute).data.array
      : (position as BufferAttribute).array
  ) as PositionArray;
  const index = indexAttr.array as IndexArray;
  const giveP = ownsBuffer(source);
  const giveI = ownsBuffer(index);
  const sentP = giveP ? source : (source.slice() as PositionArray);
  const sentI = giveI ? index : (index.slice() as IndexArray);
  const restore = (reply: Pick<BvhReply, "index" | "position">) => {
    if (giveP) {
      if (interleaved) {
        (position as InterleavedBufferAttribute).data.array = reply.position;
      } else {
        (position as BufferAttribute).array = reply.position;
      }
    }
    if (giveI) {
      indexAttr.array = reply.index;
    } else {
      // the sorted order, into the array the geometry kept
      index.set(reply.index);
    }
  };
  return {
    job: {
      position: {
        array: sentP,
        itemSize: position.itemSize,
        stride: interleaved
          ? (position as InterleavedBufferAttribute).data.stride
          : position.itemSize,
        offset: interleaved
          ? (position as InterleavedBufferAttribute).offset
          : 0,
        normalized: position.normalized,
      },
      index: sentI,
      groups: geometry.groups.map((g) => ({ ...g })),
      drawRange: { ...geometry.drawRange },
    },
    restore,
    transfer: [sentP.buffer, sentI.buffer].filter(
      (b, i, all): b is ArrayBuffer =>
        b instanceof ArrayBuffer && all.indexOf(b) === i
    ),
  };
}

/** One build in the worker; resolves whether it built (false: the worker
 *  failed — the caller may build here). The arrays are back either way. */
async function buildThere(geometry: BufferGeometry): Promise<boolean> {
  const w = startWorker();
  const taken = w ? take(geometry) : null;
  if (!(w && taken)) {
    return false;
  }
  const id = nextId++;
  building.add(geometry);
  const reply = await new Promise<BvhReply | null>((resolve) => {
    settles.set(id, resolve);
    w.postMessage({ ...taken.job, id }, taken.transfer);
  });
  building.delete(geometry);
  if (!reply) {
    // the worker died with the arrays: nothing to restore them from (the
    // GPU still draws the tile; no ray will read it)
    lost.add(geometry);
    throw new Error("BVH worker lost a tile's buffers");
  }
  taken.restore(reply);
  if (!reply.roots || geometry.boundsTree) {
    return Boolean(geometry.boundsTree);
  }
  const index = geometry.getIndex()?.array as IndexArray;
  // (`version` is read, though the types leave it out: without it the
  // nodes would be "fixed up" from the old format)
  const data = { version: 1, roots: reply.roots, index, indirectBuffer: null };
  geometry.boundsTree = MeshBVH.deserialize(data, geometry, {
    setIndex: false,
  });
  return true;
}

/**
 * Builds `geometry`'s BVH in the worker, after the builds before it;
 * where there is no worker (or it failed), here. Resolves once the
 * geometry has its BVH back (or the build failed: a ray then builds it on
 * the main thread as before).
 */
export function buildBvhOffThread(geometry: BufferGeometry): Promise<void> {
  const run = chain.then(async () => {
    if (geometry.boundsTree) {
      return;
    }
    if (!(await buildThere(geometry))) {
      geometry.computeBoundsTree();
    }
  });
  chain = run.catch(() => undefined);
  return run;
}
