/**
 * The canopy points as a packed binary (published `.pts`): the browser read
 * them as GeoJSON — up to 9.5 MB and 81 000 features a tile, one
 * `JSON.parse` of ≈ 100 ms that cannot be sliced, ≈ 117 bytes and three
 * objects per point. Packed they are 12 or 16 bytes a point and a view, no
 * parse. Written by prepare-data.ts from the committed GeoJSON (which stays
 * the bake contract), read by the dressing (tile-stream.ts).
 *
 * Layout, little-endian:
 *
 *   bytes  0–3    "PTS1"
 *   bytes  4–7    uint32 count
 *   bytes  8–11   uint32 stride (floats a point: 3 = x, y, h; 4 = x, y, h, r)
 *   bytes 12–15   reserved (0)
 *   bytes 16–31   float64 originX, float64 originY
 *   bytes 32…     float32 × count × stride; x, y relative to the origin
 *
 * Coordinates are relative to the tile's south-west corner: a float32
 * holds a northing of 5.6 million metres only to half a metre, an offset of
 * up to 2 km to a tenth of a millimetre. A missing value (a feature without
 * properties) is NaN.
 */

import type { CanopyExtraFeature, CanopyFeature } from "./features";

const MAGIC = "PTS1";
const HEADER_BYTES = 32;
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export interface PackedPoint {
  h: number;
  r?: number;
  x: number;
  y: number;
}

export interface UnpackedPoints {
  count: number;
  /** count × stride floats: x, y (relative to the origin), h[, r] */
  data: Float32Array;
  origin: [number, number];
  stride: 3 | 4;
}

export function packPoints(
  points: readonly PackedPoint[],
  origin: [number, number],
  stride: 3 | 4
): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + points.length * stride * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    view.setUint8(i, MAGIC.charCodeAt(i));
  }
  view.setUint32(4, points.length, true);
  view.setUint32(8, stride, true);
  view.setUint32(12, 0, true);
  view.setFloat64(16, origin[0], true);
  view.setFloat64(24, origin[1], true);
  points.forEach((p, i) => {
    const at = HEADER_BYTES + i * stride * 4;
    view.setFloat32(at, p.x - origin[0], true);
    view.setFloat32(at + 4, p.y - origin[1], true);
    view.setFloat32(at + 8, p.h, true);
    if (stride === 4) {
      view.setFloat32(at + 12, p.r ?? Number.NaN, true);
    }
  });
  return bytes;
}

/** The points of a packed buffer, or null for anything that is not one. */
export function unpackPoints(buffer: ArrayBuffer): UnpackedPoints | null {
  if (buffer.byteLength < HEADER_BYTES) {
    return null;
  }
  const view = new DataView(buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    if (view.getUint8(i) !== MAGIC.charCodeAt(i)) {
      return null;
    }
  }
  const count = view.getUint32(4, true);
  const stride = view.getUint32(8, true);
  if (
    !(stride === 3 || stride === 4) ||
    buffer.byteLength !== HEADER_BYTES + count * stride * 4
  ) {
    return null;
  }
  // The floats sit at an aligned offset: on a little-endian platform (every
  // one a browser runs on) a view, no copy; else read them one by one.
  let data: Float32Array;
  if (LITTLE_ENDIAN) {
    data = new Float32Array(buffer, HEADER_BYTES, count * stride);
  } else {
    data = new Float32Array(count * stride);
    for (let i = 0; i < data.length; i++) {
      data[i] = view.getFloat32(HEADER_BYTES + i * 4, true);
    }
  }
  return {
    count,
    data,
    origin: [view.getFloat64(16, true), view.getFloat64(24, true)],
    stride,
  };
}

/** A canopy feature as a point to pack (a crown radius when it has one). */
export function pointOf(
  feature: CanopyFeature | CanopyExtraFeature
): PackedPoint {
  const [x, y] = feature.geometry.coordinates;
  const p = feature.properties as { h?: number; r?: number } | null;
  return { x, y, h: p?.h ?? Number.NaN, r: p?.r };
}

/**
 * The packed points back as the features the vegetation reads (`{ h }`, or
 * `{ h, r }` at stride 4), so every consumer of the canopy stays as it was.
 */
export function pointFeatures(
  points: UnpackedPoints
): (CanopyFeature | CanopyExtraFeature)[] {
  const { count, data, origin, stride } = points;
  const [ox, oy] = origin;
  const out: (CanopyFeature | CanopyExtraFeature)[] = [];
  for (let i = 0; i < count; i++) {
    const at = i * stride;
    const h = data[at + 2] ?? Number.NaN;
    const r = stride === 4 ? (data[at + 3] ?? Number.NaN) : Number.NaN;
    const geometry = {
      type: "Point" as const,
      coordinates: [ox + (data[at] ?? 0), oy + (data[at + 1] ?? 0)] as [
        number,
        number,
      ],
    };
    if (Number.isNaN(h)) {
      out.push({ geometry, properties: null });
    } else if (stride === 4 && !Number.isNaN(r)) {
      const extra: CanopyExtraFeature = { geometry, properties: { h, r } };
      out.push(extra);
    } else {
      out.push({ geometry, properties: { h } });
    }
  }
  return out;
}
