/**
 * gltf-transform's `weld` (merge bitwise identical vertices), the same
 * vertices merged into the same order, faster. Its hash table reads every
 * vertex byte by byte through a scratch buffer: on a heavy building tile
 * (11 M vertices, the bake's welds before and after its far twin) that was
 * 2.5 s of the bake. Here the table reads each attribute as 32-bit words.
 *
 * What `weld` writes does not depend on its hash: a vertex goes to the
 * first earlier one whose bytes are all equal, and the merged vertices are
 * numbered in the order they first occur, so any exact table gives the same
 * remap, which gltf-transform's own `compactPrimitive` then applies. A
 * primitive whose attributes are not whole words (a 3-byte normal), points
 * or one with morph targets go to `weldPrimitive`; a document `weld` would
 * also prune (an empty primitive or mesh) or refuse (primitive restart) to
 * `weld` itself. Build-time only.
 */
import { Primitive } from "@gltf-transform/core";
import type { Document, Transform } from "@gltf-transform/core";
import {
  compactPrimitive,
  createTransform,
  getPrimitiveVertexCount,
  VertexCountMethod,
  weld,
  weldPrimitive,
} from "@gltf-transform/functions";

const EMPTY = 0xff_ff_ff_ff;

/** The attributes of `prim` as 32-bit words per vertex, or undefined
 *  where one is not (its element is no whole number of words, or its array
 *  starts off a word). */
function wordsOf(
  prim: Primitive
): { words: Uint32Array; stride: number }[] | undefined {
  const out: { words: Uint32Array; stride: number }[] = [];
  for (const attribute of prim.listAttributes()) {
    const array = attribute.getArray();
    const bytes = attribute.getElementSize() * attribute.getComponentSize();
    if (!array || bytes % 4 !== 0 || array.byteOffset % 4 !== 0) {
      return undefined;
    }
    out.push({
      words: new Uint32Array(
        array.buffer,
        array.byteOffset,
        array.byteLength / 4
      ),
      stride: bytes / 4,
    });
  }
  return out;
}

/** `weldPrimitive`'s remap: for each source vertex its merged index, in
 *  the order the index (or the vertices) first name them. */
export function weldRemap(
  attributes: readonly { words: Uint32Array; stride: number }[],
  vertexCount: number,
  indices: ArrayLike<number> | null
): { remap: Uint32Array<ArrayBuffer>; count: number } {
  let size = 1;
  while (size < vertexCount + vertexCount / 4) {
    size *= 2;
  }
  const mask = size - 1;
  const table = new Uint32Array(size).fill(EMPTY);
  const remap = new Uint32Array(vertexCount).fill(EMPTY);
  const lists = attributes.map((a) => a.words);
  const strides = attributes.map((a) => a.stride);
  const n = lists.length;
  // every attribute in the hash: the vertices at a corner share their
  // position and differ in their normals. Murmur3's mixing: whole floats
  // and axis normals have empty low bits, which a plain multiply would
  // never carry into the bucket
  const hash = (v: number) => {
    let h = 0;
    for (let a = 0; a < n; a++) {
      const words = lists[a];
      const stride = strides[a];
      for (let k = v * stride, end = k + stride; k < end; k++) {
        let w = Math.imul(words[k], 0xcc_9e_2d_51);
        w = Math.imul((w << 15) | (w >>> 17), 0x1b_87_35_93);
        h ^= w;
        h = Math.imul((h << 13) | (h >>> 19), 5) + 0xe6_54_6b_64;
      }
    }
    h = Math.imul(h ^ (h >>> 16), 0x85_eb_ca_6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2_b2_ae_35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const equal = (x: number, y: number) => {
    for (let a = 0; a < n; a++) {
      const words = lists[a];
      const stride = strides[a];
      for (let k = 0; k < stride; k++) {
        if (words[x * stride + k] !== words[y * stride + k]) {
          return false;
        }
      }
    }
    return true;
  };
  const total = indices ? indices.length : vertexCount;
  let count = 0;
  for (let i = 0; i < total; i++) {
    const v = indices ? indices[i] : i;
    if (remap[v] !== EMPTY) {
      continue;
    }
    // triangular probes visit every bucket of a power-of-two table, and it
    // holds at most vertexCount < size items: an empty one is always found
    let bucket = hash(v) & mask;
    for (let probe = 0; ; probe++) {
      const item = table[bucket];
      if (item === EMPTY) {
        table[bucket] = v;
        remap[v] = count++;
        break;
      }
      if (equal(item, v)) {
        remap[v] = remap[item];
        break;
      }
      bucket = (bucket + probe + 1) & mask;
    }
  }
  return { remap, count };
}

/** `weld()`, faster where it can be (see the module's comment). */
export function weldExact(): Transform {
  return createTransform("weldExact", (doc: Document, context) => {
    const meshes = doc.getRoot().listMeshes();
    const prims = meshes.flatMap((mesh) => mesh.listPrimitives());
    if (
      doc.hasExtension("KHR_mesh_primitive_restart") ||
      meshes.some((mesh) => mesh.listPrimitives().length === 0) ||
      prims.some(
        (prim) => getPrimitiveVertexCount(prim, VertexCountMethod.RENDER) === 0
      )
    ) {
      // weld's transform is async under Transform's void type; returned,
      // doc.transform awaits it
      return weld()(doc, context);
    }
    for (const prim of prims) {
      const position = prim.getAttribute("POSITION");
      const plan =
        position &&
        prim.getMode() !== Primitive.Mode.POINTS &&
        prim.listTargets().length === 0
          ? wordsOf(prim)
          : undefined;
      if (!(position && plan)) {
        weldPrimitive(prim);
        continue;
      }
      const { remap, count } = weldRemap(
        plan,
        position.getCount(),
        prim.getIndices()?.getArray() ?? null
      );
      compactPrimitive(prim, remap, count);
    }
    return undefined;
  });
}
