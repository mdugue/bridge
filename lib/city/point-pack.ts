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
 *   bytes  8–11   uint32 stride (floats a point: 3 = x, y, h; 4 = x, y, h, r;
 *                 5 = x, y, h, r, flags)
 *   bytes 12–15   uint32 flags: ROWS_MEASURED when the canopy holds its
 *                 tile's tree rows' trees (canopy.py's `rows` member)
 *   bytes 16–31   float64 originX, float64 originY
 *   bytes 32…     float32 × count × stride; x, y relative to the origin
 *
 * Coordinates are relative to the tile's south-west corner: a float32
 * holds a northing of 5.6 million metres only to half a metre, an offset of
 * up to 2 km to a tenth of a millimetre. A missing value (a feature without
 * properties) is NaN. `flags` is what the canopy bake told of the crown:
 * its leaves (`LEAF`: 0 a broadleaf or not known, 1 an evergreen by its
 * forest's kind, 2 one the leaf-off orthophoto showed green) plus
 * `OVER_ROAD` when it reaches over a carriageway (`c: 1`) and `PINE` when
 * an evergreen's crown is a pine's flat top (`pine: 1`); a canopy with
 * none of them is packed at stride 3.
 */

import type { CanopyExtraFeature, CanopyFeature } from "./features";

const MAGIC = "PTS1";
const HEADER_BYTES = 32;
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export interface PackedPoint {
  /** 1: the crown reaches over a carriageway */
  c?: 1;
  h: number;
  /** 0, or an evergreen (LEAF) */
  leaf?: number;
  /** 1: an evergreen whose crown is a pine's */
  pine?: 1;
  r?: number;
  x: number;
  y: number;
}

/** The flags column's leaf codes: the canopy's `l: "e"`, and its
 *  `ls: "dop"`. */
export const LEAF = { evergreen: 1, evergreenPhoto: 2 } as const;
/** The flags column's bit for the canopy's `c: 1`, over the leaf code. */
export const OVER_ROAD = 4;
/** The flags column's bit for the canopy's `pine: 1` (pipeline/bake/
 *  crown_form.py), over the leaf code. */
export const PINE = 8;
/** The header's flag: the canopy bake placed the tile's tree rows' trees
 *  (at DOM1's crown peaks), so the viewer plants none of its own. A canopy
 *  baked before that lacks it, and its rows are still planted. */
export const ROWS_MEASURED = 1;

type Stride = 3 | 4 | 5;

export interface UnpackedPoints {
  count: number;
  /** count × stride floats: x, y (relative to the origin), h[, r[, flags]] */
  data: Float32Array;
  /** the header's flags (ROWS_MEASURED) */
  flags: number;
  origin: [number, number];
  stride: Stride;
}

export function packPoints(
  points: readonly PackedPoint[],
  origin: [number, number],
  stride: Stride,
  flags = 0
): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + points.length * stride * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    view.setUint8(i, MAGIC.charCodeAt(i));
  }
  view.setUint32(4, points.length, true);
  view.setUint32(8, stride, true);
  view.setUint32(12, flags, true);
  view.setFloat64(16, origin[0], true);
  view.setFloat64(24, origin[1], true);
  points.forEach((p, i) => {
    const at = HEADER_BYTES + i * stride * 4;
    view.setFloat32(at, p.x - origin[0], true);
    view.setFloat32(at + 4, p.y - origin[1], true);
    view.setFloat32(at + 8, p.h, true);
    if (stride >= 4) {
      view.setFloat32(at + 12, p.r ?? Number.NaN, true);
    }
    if (stride === 5) {
      view.setFloat32(
        at + 16,
        (p.leaf ?? 0) + (p.c === 1 ? OVER_ROAD : 0) + (p.pine === 1 ? PINE : 0),
        true
      );
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
    !(stride === 3 || stride === 4 || stride === 5) ||
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
    flags: view.getUint32(12, true),
    origin: [view.getFloat64(16, true), view.getFloat64(24, true)],
    stride,
  };
}

/** A canopy feature as a point to pack (a crown radius when it has one,
 *  its leaves and its reach over a carriageway when the bake told them). */
export function pointOf(
  feature: CanopyFeature | CanopyExtraFeature
): PackedPoint {
  const [x, y] = feature.geometry.coordinates;
  const p = feature.properties as {
    c?: number;
    h?: number;
    l?: string;
    ls?: string;
    pine?: number;
    r?: number;
  } | null;
  const leaf =
    p?.l === "e" ? (p.ls === "dop" ? LEAF.evergreenPhoto : LEAF.evergreen) : 0;
  return {
    x,
    y,
    h: p?.h ?? Number.NaN,
    r: p?.r,
    ...(leaf ? { leaf } : {}),
    ...(p?.c === 1 ? { c: 1 as const } : {}),
    ...(leaf && p?.pine === 1 ? { pine: 1 as const } : {}),
  };
}

/** The stride a canopy file packs at: 3, or 5 when a crown is an evergreen
 *  or reaches over a carriageway (the flags column); a scan's crowns
 *  (`canopyx`, with radii) at 4. */
export function canopyStride(
  points: readonly PackedPoint[],
  radii: boolean
): Stride {
  if (points.some((p) => (p.leaf ?? 0) > 0 || p.c === 1)) {
    return 5;
  }
  return radii ? 4 : 3;
}

/** A packed point's properties from its height and its flags column. */
function flaggedProperties(
  h: number,
  flags: number
): NonNullable<CanopyFeature["properties"]> {
  const leaf = flags % OVER_ROAD;
  const evergreen = leaf === LEAF.evergreen || leaf === LEAF.evergreenPhoto;
  return {
    h,
    ...(evergreen ? { l: "e" as const } : {}),
    ...(leaf === LEAF.evergreenPhoto ? { ls: "dop" as const } : {}),
    ...((flags & OVER_ROAD) === 0 ? {} : { c: 1 as const }),
    ...(evergreen && (flags & PINE) !== 0 ? { pine: 1 as const } : {}),
  };
}

/**
 * The packed points back as the features the vegetation reads (`{ h }`,
 * `{ h, r }` at stride 4, and an evergreen's `l`/`ls`/`pine` and a crown
 * over a carriageway's `c` at stride 5, beside its `r` too), so every
 * consumer of the canopy stays as it was.
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
    const r = stride >= 4 ? (data[at + 3] ?? Number.NaN) : Number.NaN;
    const flags = stride === 5 ? (data[at + 4] ?? 0) : 0;
    const geometry = {
      type: "Point" as const,
      coordinates: [ox + (data[at] ?? 0), oy + (data[at + 1] ?? 0)] as [
        number,
        number,
      ],
    };
    if (Number.isNaN(h)) {
      out.push({ geometry, properties: null });
    } else if (!Number.isNaN(r)) {
      const extra: CanopyExtraFeature = {
        geometry,
        properties: { ...flaggedProperties(h, flags), r },
      };
      out.push(extra);
    } else {
      out.push({ geometry, properties: flaggedProperties(h, flags) });
    }
  }
  return out;
}
