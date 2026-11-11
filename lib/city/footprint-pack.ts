/**
 * A tile's building footprints as a packed binary (published `.fpr.gz`):
 * the minimap read them as JSON — 11 MB for Dresden at every start, one
 * `JSON.parse` a tile, and 920 000 points held as two-element arrays
 * (≈ 50 MB of heap). Packed they are two integers a point and three typed
 * arrays a tile, read without a parse. Written by scripts/prepare/city.ts
 * from the buildings' bake, read by the minimap (create-app.ts, minimap.tsx),
 * a design's cover (design-layer.ts) and the site's numbers
 * (scripts/prepare/stats.ts). No THREE, no DOM.
 *
 * `[object][ring][vertex] = [x, y]`, EPSG metres at centimetres (as the
 * bake rounds them). Layout, little-endian:
 *
 *   bytes  0–3    "FPR1"
 *   bytes  4–7    uint32 objects
 *   bytes  8–11   uint32 rings
 *   bytes 12–15   uint32 points
 *   then          uint32 × objects: the rings up to and with each object
 *   then          uint32 × rings: the points up to and with each ring
 *   then          int32 × points × 2: x, y in centimetres, each the step
 *                 from the point before (the first from 0) — small numbers
 *                 the gzip around the file packs well
 */

const MAGIC = "FPR1";
const HEADER_BYTES = 16;

type Rings = readonly (readonly (readonly [number, number])[])[];

/** A tile's footprints, read (`readFootprints`). */
export interface FootprintPack {
  /** per object: its rings end here in `ringEnd` (and begin where the
   *  object before ends) */
  objectEnd: Uint32Array;
  /** per ring: its points end here (and begin where the ring before ends) */
  ringEnd: Uint32Array;
  /** per point: x, y in EPSG centimetres */
  xy: Int32Array;
}

/** The footprints packed (the file's bytes, before its gzip). */
export function packFootprints(objects: readonly Rings[]): Uint8Array {
  const rings = objects.flat();
  const points = rings.reduce((n, ring) => n + ring.length, 0);
  const bytes = new Uint8Array(
    HEADER_BYTES + 4 * objects.length + 4 * rings.length + 8 * points
  );
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < MAGIC.length; i += 1) {
    bytes[i] = MAGIC.codePointAt(i) ?? 0;
  }
  view.setUint32(4, objects.length, true);
  view.setUint32(8, rings.length, true);
  view.setUint32(12, points, true);
  let at = HEADER_BYTES;
  let ringCount = 0;
  for (const object of objects) {
    ringCount += object.length;
    view.setUint32(at, ringCount, true);
    at += 4;
  }
  let pointCount = 0;
  for (const ring of rings) {
    pointCount += ring.length;
    view.setUint32(at, pointCount, true);
    at += 4;
  }
  let lastX = 0;
  let lastY = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      const cx = Math.round(x * 100);
      const cy = Math.round(y * 100);
      view.setInt32(at, cx - lastX, true);
      view.setInt32(at + 4, cy - lastY, true);
      at += 8;
      lastX = cx;
      lastY = cy;
    }
  }
  return bytes;
}

/** The packed footprints read, or null for bytes that are not such a file
 *  (another magic, or cut short). */
export function readFootprints(
  buffer: ArrayBuffer | Uint8Array
): FootprintPack | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (
    bytes.byteLength < HEADER_BYTES ||
    String.fromCodePoint(...bytes.subarray(0, 4)) !== MAGIC
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const objects = view.getUint32(4, true);
  const rings = view.getUint32(8, true);
  const points = view.getUint32(12, true);
  if (
    bytes.byteLength !==
    HEADER_BYTES + 4 * objects + 4 * rings + 8 * points
  ) {
    return null;
  }
  let at = HEADER_BYTES;
  const objectEnd = new Uint32Array(objects);
  for (let i = 0; i < objects; i += 1) {
    objectEnd[i] = view.getUint32(at, true);
    at += 4;
  }
  const ringEnd = new Uint32Array(rings);
  for (let i = 0; i < rings; i += 1) {
    ringEnd[i] = view.getUint32(at, true);
    at += 4;
  }
  const xy = new Int32Array(2 * points);
  let x = 0;
  let y = 0;
  for (let i = 0; i < points; i += 1) {
    x += view.getInt32(at, true);
    y += view.getInt32(at + 4, true);
    at += 8;
    xy[2 * i] = x;
    xy[2 * i + 1] = y;
  }
  return { objectEnd, ringEnd, xy };
}

/** One object's rings, in metres (a new array each call). */
export function ringsOf(
  pack: FootprintPack,
  object: number
): [number, number][][] {
  const out: [number, number][][] = [];
  const first = object === 0 ? 0 : pack.objectEnd[object - 1];
  for (let r = first; r < pack.objectEnd[object]; r += 1) {
    const ring: [number, number][] = [];
    for (
      let p = r === 0 ? 0 : pack.ringEnd[r - 1];
      p < pack.ringEnd[r];
      p += 1
    ) {
      ring.push([pack.xy[2 * p] / 100, pack.xy[2 * p + 1] / 100]);
    }
    out.push(ring);
  }
  return out;
}

/** Every object's rings, as the bake wrote them (for the build: the
 *  viewer reads the pack as it is). */
export function unpackedFootprints(
  pack: FootprintPack
): [number, number][][][] {
  return Array.from(pack.objectEnd, (_, object) => ringsOf(pack, object));
}
