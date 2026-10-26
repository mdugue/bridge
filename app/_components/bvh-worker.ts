/**
 * The BVH worker: a building tile's BVH (three-mesh-bvh's `MeshBVH`, the
 * options `computeBoundsTree` uses) built off the main thread. The tile's
 * positions and index come handed over, not copied (bvh-client.ts); the
 * build sorts the index in place, and both go back with the BVH's nodes.
 */
import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from "three/webgpu";
import { MeshBVH } from "three-mesh-bvh";
import type { BvhJob, BvhReply } from "./bvh-client";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BvhJob>) => void) | null;
  postMessage: (message: BvhReply, transfer: Transferable[]) => void;
};

function geometryOf(job: BvhJob): BufferGeometry {
  const geometry = new BufferGeometry();
  const p = job.position;
  geometry.setAttribute(
    "position",
    p.stride === p.itemSize && p.offset === 0
      ? new BufferAttribute(p.array, p.itemSize, p.normalized)
      : new InterleavedBufferAttribute(
          new InterleavedBuffer(p.array, p.stride),
          p.itemSize,
          p.offset,
          p.normalized
        )
  );
  geometry.setIndex(new BufferAttribute(job.index, 1));
  for (const group of job.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.setDrawRange(job.drawRange.start, job.drawRange.count);
  return geometry;
}

scope.onmessage = ({ data: job }) => {
  try {
    const bvh = new MeshBVH(geometryOf(job));
    const { roots } = MeshBVH.serialize(bvh, { cloneBuffers: false });
    scope.postMessage(
      { id: job.id, roots, index: job.index, position: job.position.array },
      [...roots, job.index.buffer, job.position.array.buffer]
    );
  } catch (err) {
    // the arrays go back whatever happened: the tile still needs them
    scope.postMessage(
      {
        id: job.id,
        error: err instanceof Error ? err.message : String(err),
        index: job.index,
        position: job.position.array,
      },
      [job.index.buffer, job.position.array.buffer]
    );
  }
};
