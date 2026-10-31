/**
 * EXT_meshopt_compression → KHR_meshopt_compression, with the attribute
 * streams re-encoded in meshopt's v1 codec. gltf-transform writes only the
 * EXT extension and its v0 attribute codec; KHR (ratified by Khronos in
 * 2025) allows v1, which packs our quantised attributes about 14 % smaller
 * before gzip; each stream keeps the codec that gzips smaller (`reencode`;
 * the numbers in docs/data-pipeline.md). three's GLTFLoader and its meshopt
 * decoder read both. Index streams keep their bytes: v1 is a codec for
 * attributes.
 *
 * `toKhrMeshopt` is the last step of a glb's writing (tile-glb.ts);
 * `toExtMeshopt` hands such a glb back to gltf-transform, whose reader
 * knows only the EXT name — its decoder (meshoptimizer's) reads v1 as well.
 * Build-time only; no DOM.
 */
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { readGlb, writeGlb, pad } from "./glb-container";

const EXT = "EXT_meshopt_compression";
const KHR = "KHR_meshopt_compression";

/** A compressed buffer view's extension (the same members in both). */
interface MeshoptView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
  filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL" | "COLOR";
}

interface Extended {
  extensions?: Record<string, unknown>;
}

interface MeshoptGltf {
  bufferViews?: (Extended & {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
  })[];
  buffers?: (Extended & { byteLength: number; uri?: string })[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

/** Renames extension `from` to `to` on every object that names it. */
function rename(json: MeshoptGltf, from: string, to: string): void {
  const swap = (names?: string[]) =>
    names?.map((name) => (name === from ? to : name));
  json.extensionsUsed = swap(json.extensionsUsed);
  json.extensionsRequired = swap(json.extensionsRequired);
  for (const holder of [...(json.bufferViews ?? []), ...(json.buffers ?? [])]) {
    const ext = holder.extensions?.[from];
    if (ext !== undefined && holder.extensions) {
      delete holder.extensions[from];
      holder.extensions[to] = ext;
    }
  }
}

/** The size of `bytes` gzipped as the bake gzips a glb
 *  (scripts/prepare/context.ts `gz`). */
const gzipped = (bytes: Uint8Array): number =>
  Bun.gzipSync(bytes as Uint8Array<ArrayBuffer>, {
    level: 9,
    library: "libdeflate",
  }).length;

/**
 * The bytes a compressed view's attribute stream holds: in v1 where that
 * gzips smaller, else as they were (v0, which KHR allows too). v1 is
 * smaller before gzip for every stream, but a TIN's positions, already
 * cache-ordered and smooth, gzip a little better in v0.
 */
function reencode(ext: MeshoptView, source: Uint8Array): Uint8Array {
  if (ext.mode !== "ATTRIBUTES") {
    return source;
  }
  const raw = new Uint8Array(ext.count * ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(
    raw,
    ext.count,
    ext.byteStride,
    source,
    ext.mode,
    ext.filter
  );
  const v1 = MeshoptEncoder.encodeGltfBuffer(
    raw,
    ext.count,
    ext.byteStride,
    ext.mode,
    1
  );
  return gzipped(v1) < gzipped(source) ? v1 : source;
}

/**
 * The same glb under KHR_meshopt_compression, its attribute streams in
 * meshopt's v1 codec and its BIN chunk laid out anew (each view 8-byte
 * aligned, in the order of the views). A glb without EXT comes back as it
 * was. Needs `MeshoptEncoder.ready` and `MeshoptDecoder.ready`.
 */
export function toKhrMeshopt(glb: Uint8Array): Uint8Array {
  const { json, bin } = readGlb<MeshoptGltf>(glb);
  if (!(json.extensionsUsed ?? []).includes(EXT)) {
    return glb;
  }
  // the glb's own buffer: no uri, and not a meshopt fallback
  const own = (json.buffers ?? []).findIndex(
    (b) => b.uri === undefined && b.extensions?.[EXT] === undefined
  );
  const chunks: Uint8Array[] = [];
  let length = 0;
  const append = (bytes: Uint8Array): number => {
    const offset = pad(length, 8);
    chunks.push(new Uint8Array(offset - length), bytes);
    length = offset + bytes.length;
    return offset;
  };
  const slice = (offset = 0, byteLength = 0) =>
    bin.subarray(offset, offset + byteLength);
  for (const view of json.bufferViews ?? []) {
    const ext = view.extensions?.[EXT] as MeshoptView | undefined;
    if (ext?.buffer === own) {
      const bytes = reencode(ext, slice(ext.byteOffset, ext.byteLength));
      ext.byteOffset = append(bytes);
      ext.byteLength = bytes.length;
    } else if (view.buffer === own) {
      view.byteOffset = append(slice(view.byteOffset, view.byteLength));
    }
  }
  const total = pad(length, 4);
  chunks.push(new Uint8Array(total - length));
  if (own !== -1) {
    (json.buffers ?? [])[own].byteLength = total;
  }
  rename(json, EXT, KHR);
  return writeGlb(json, chunks);
}

/** A glb `toKhrMeshopt` wrote, named EXT again for gltf-transform's reader
 *  (the streams stay as they are). A glb without KHR comes back as it was. */
export function toExtMeshopt(glb: Uint8Array): Uint8Array {
  const { json, bin } = readGlb<MeshoptGltf>(glb);
  if (!(json.extensionsUsed ?? []).includes(KHR)) {
    return glb;
  }
  rename(json, KHR, EXT);
  return writeGlb(json, [bin]);
}
