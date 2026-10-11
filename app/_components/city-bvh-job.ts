// Plain `three` (its core), not `three/webgpu`: this module is the BVH
// worker's (city-bvh.worker.ts), which never renders — the renderer would
// only weigh down its chunk. three-mesh-bvh imports the same.
import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  type TypedArray,
} from "three";
import { MeshBVH, type SerializedBVH } from "three-mesh-bvh";

/**
 * A building tile's BVH build as a message (city-bvh.worker.ts runs it off
 * the main thread, city-bvh.ts sends it): the geometry's positions and
 * index as they are, and how the positions are laid out. The tiles'
 * positions are quantised (scripts/tile-glb.ts: int16, `normalized`, the
 * dequantisation on the node) and interleaved at a stride of four
 * (the glTF's byteStride of 8): the worker rebuilds the attribute exactly
 * so — three-mesh-bvh's own GenerateMeshBVHWorker reads any position array
 * as a plain, non-normalized vec3 and refuses an interleaved one.
 */
export interface BvhJob {
  id: number;
  position: {
    array: TypedArray;
    itemSize: number;
    normalized: boolean;
    /** elements per vertex in `array` where it is interleaved, else 0 */
    stride: number;
    /** the attribute's first element within each vertex (interleaved) */
    offset: number;
  };
  index: Uint16Array | Uint32Array;
  drawRange: { start: number; count: number };
  groups: { start: number; count: number; materialIndex?: number }[];
}

/**
 * The worker's answer: the arrays it was lent, always (the index sorted in
 * place where the build ran), and the BVH (`serialized`, its `version`
 * with it: `MeshBVH.deserialize` rewrites an unversioned one) or why not.
 */
export interface BvhReply {
  id: number;
  position: TypedArray;
  index: Uint16Array | Uint32Array;
  serialized?: SerializedBVH;
  error?: string;
}

/** The job's geometry as the main thread holds it: same layout, same
 *  draw range and groups (the BVH covers what they cover). */
export function jobGeometry(job: BvhJob): BufferGeometry {
  const geometry = new BufferGeometry();
  const p = job.position;
  geometry.setAttribute(
    "position",
    p.stride > 0
      ? new InterleavedBufferAttribute(
          new InterleavedBuffer(p.array, p.stride),
          p.itemSize,
          p.offset,
          p.normalized
        )
      : new BufferAttribute(p.array, p.itemSize, p.normalized)
  );
  geometry.setIndex(new BufferAttribute(job.index, 1));
  geometry.setDrawRange(job.drawRange.start, job.drawRange.count);
  for (const group of job.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  return geometry;
}

/**
 * Builds the job's BVH as the main thread's `computeBoundsTree()` does
 * (`new MeshBVH(geometry)`, no options: the same tree, the same sorted
 * index). Never throws: a failure answers with the arrays and its message.
 */
export function buildJob(job: BvhJob): BvhReply {
  const reply = { id: job.id, position: job.position.array, index: job.index };
  try {
    const bvh = new MeshBVH(jobGeometry(job));
    // the node buffers themselves, transferred back (no copies)
    return {
      ...reply,
      serialized: MeshBVH.serialize(bvh, { cloneBuffers: false }),
    };
  } catch (err) {
    return {
      ...reply,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The buffers a message hands over, each once (a buffer listed twice
 *  fails the post) — never a SharedArrayBuffer, which is shared, not
 *  moved. */
export function transferOf(
  arrays: readonly (ArrayBufferView | null | undefined)[],
  buffers: readonly ArrayBufferLike[] = []
): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const buffer of [...arrays.map((a) => a?.buffer), ...buffers] as (
    | ArrayBufferLike
    | undefined
  )[]) {
    if (buffer instanceof ArrayBuffer) {
      out.add(buffer);
    }
  }
  return [...out];
}

/** What a reply hands back to the main thread. */
export function replyTransfer(reply: BvhReply): ArrayBuffer[] {
  return transferOf(
    [reply.position, reply.index, reply.serialized?.indirectBuffer],
    reply.serialized?.roots ?? []
  );
}
