/**
 * What a geometry's buffers weigh on the GPU as three r187's WebGPU
 * backend uploads them (read in
 * node_modules/three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js,
 * `createAttribute`): an interleaved buffer as it is; a plain attribute of
 * 8- or 16-bit integers that is not normalized widened to 32 bits; an
 * item whose bytes are no multiple of four padded to one; every buffer
 * rounded up to four bytes. For plan 090's measuring scripts: the tile
 * cache's own estimate (three-utils.ts `estimateGeometryBytes`) counts
 * the CPU arrays, which is the same figure only for floats.
 */
import type {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
} from "three/webgpu";

type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

const pad4 = (bytes: number): number => bytes + ((4 - (bytes % 4)) % 4);

function plainBytes(attribute: BufferAttribute, index: boolean): number {
  const { array, itemSize, normalized, count } = attribute;
  let bytesPerElement = array.BYTES_PER_ELEMENT;
  const small = bytesPerElement < 4 && !(array instanceof Float32Array);
  if (small && !normalized && !(index && bytesPerElement === 2)) {
    bytesPerElement = 4;
  }
  let stride = itemSize * bytesPerElement;
  if (itemSize > 1 && stride % 4 !== 0) {
    stride = pad4(stride);
  }
  return pad4(count * stride);
}

/** The GPU bytes of `geometries`' buffers, each buffer once. */
export function gpuBytesOf(geometries: Iterable<BufferGeometry>): number {
  const seen = new Set<object>();
  let bytes = 0;
  const add = (attribute: AnyAttribute | null, index: boolean) => {
    if (!attribute) {
      return;
    }
    const interleaved = (attribute as InterleavedBufferAttribute).data as
      | InterleavedBufferAttribute["data"]
      | undefined;
    const key = interleaved ?? attribute;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    bytes += interleaved
      ? pad4(interleaved.array.byteLength)
      : plainBytes(attribute as BufferAttribute, index);
  };
  for (const geometry of geometries) {
    add(geometry.index, true);
    for (const attribute of Object.values(geometry.attributes)) {
      add(attribute, false);
    }
  }
  return bytes;
}
