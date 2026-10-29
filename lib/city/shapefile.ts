/**
 * Reads a landscape plan's Shapefile (ADR 0054): the geometry (.shp) and
 * its attributes (.dbf, in the encoding its .cpg names), as records the
 * plan reader (plan-records.ts) turns into features. Points, multipoints,
 * polylines and polygons, with Z where the file has it; a polygon's parts
 * are its rings, nested by plan-geometry.ts. No THREE, no DOM.
 */

import type { PlanPoint } from "./plan-geometry";

/** One shape with its attributes. */
export interface GeoRecord {
  kind: "point" | "line" | "polygon";
  /** a point's: one part of one point; a line's parts; a polygon's rings */
  parts: PlanPoint[][];
  attributes: Record<string, string | number | null>;
}

const POINT = new Set([1, 11, 21]);
const MULTIPOINT = new Set([8, 18, 28]);
const LINE = new Set([3, 13, 23]);
const POLYGON = new Set([5, 15, 25]);
const HAS_Z = new Set([11, 13, 15, 18]);

/** A shape's parts as point lists (x, y from the record, z after). */
function readParts(view: DataView, at: number, type: number): PlanPoint[][] {
  const numParts = view.getInt32(at + 36, true);
  const numPoints = view.getInt32(at + 40, true);
  const partsAt = at + 44;
  const pointsAt = partsAt + numParts * 4;
  const starts = Array.from({ length: numParts }, (_, i) =>
    view.getInt32(partsAt + i * 4, true)
  );
  // Z: a range, then one per point, after the points
  const zAt = pointsAt + numPoints * 16 + 16;
  const z = (i: number) =>
    HAS_Z.has(type) ? view.getFloat64(zAt + i * 8, true) : undefined;
  return starts.map((start, p) => {
    const end = starts[p + 1] ?? numPoints;
    const part: PlanPoint[] = [];
    for (let i = start; i < end; i++) {
      const x = view.getFloat64(pointsAt + i * 16, true);
      const y = view.getFloat64(pointsAt + i * 16 + 8, true);
      const zi = z(i);
      part.push(zi === undefined ? [x, y] : [x, y, zi]);
    }
    return part;
  });
}

/** A multipoint's points, one part each. */
function readMultipoint(view: DataView, at: number, type: number) {
  const n = view.getInt32(at + 36, true);
  const zAt = at + 40 + n * 16 + 16;
  return Array.from({ length: n }, (_, i): PlanPoint[] => {
    const x = view.getFloat64(at + 40 + i * 16, true);
    const y = view.getFloat64(at + 40 + i * 16 + 8, true);
    return HAS_Z.has(type)
      ? [[x, y, view.getFloat64(zAt + i * 8, true)]]
      : [[x, y]];
  });
}

/** The shapes of a .shp, in record order (null shapes as null). */
export function readShp(
  bytes: ArrayBuffer
): ({ kind: GeoRecord["kind"]; parts: PlanPoint[][] } | null)[] {
  const view = new DataView(bytes);
  if (view.byteLength < 100 || view.getInt32(0, false) !== 9994) {
    throw new Error("keine .shp-Datei");
  }
  const out: ({ kind: GeoRecord["kind"]; parts: PlanPoint[][] } | null)[] = [];
  let at = 100;
  while (at + 8 <= view.byteLength) {
    const length = view.getInt32(at + 4, false) * 2;
    const content = at + 8;
    const type = view.getInt32(content, true);
    if (POINT.has(type)) {
      const x = view.getFloat64(content + 4, true);
      const y = view.getFloat64(content + 12, true);
      const z = HAS_Z.has(type)
        ? view.getFloat64(content + 20, true)
        : undefined;
      out.push({
        kind: "point",
        parts: [[z === undefined ? [x, y] : [x, y, z]]],
      });
    } else if (MULTIPOINT.has(type)) {
      out.push({ kind: "point", parts: readMultipoint(view, content, type) });
    } else if (LINE.has(type)) {
      out.push({ kind: "line", parts: readParts(view, content, type) });
    } else if (POLYGON.has(type)) {
      out.push({ kind: "polygon", parts: readParts(view, content, type) });
    } else {
      out.push(null);
    }
    at = content + length;
  }
  return out;
}

/** The decoder for a .cpg's code page name (UTF-8 where unsaid). */
export function dbfDecoder(cpg: string | null): TextDecoder {
  const name = (cpg ?? "").trim().toLowerCase();
  if (/1252|latin|8859-1|ansi/.test(name)) {
    return new TextDecoder("windows-1252");
  }
  if (/8859-15/.test(name)) {
    return new TextDecoder("iso-8859-15");
  }
  return new TextDecoder("utf-8");
}

/** The records of a .dbf: each field's value, numbers as numbers. */
export function readDbf(
  bytes: ArrayBuffer,
  decoder: TextDecoder
): Record<string, string | number | null>[] {
  const view = new DataView(bytes);
  const count = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields: { name: string; type: string; length: number }[] = [];
  const raw = new Uint8Array(bytes);
  for (let at = 32; at < headerLength - 1 && raw[at] !== 0x0d; at += 32) {
    const nameBytes = raw.subarray(at, at + 11);
    const end = nameBytes.indexOf(0);
    fields.push({
      name: decoder.decode(nameBytes.subarray(0, end < 0 ? 11 : end)),
      type: String.fromCharCode(raw[at + 11]),
      length: raw[at + 16],
    });
  }
  const out: Record<string, string | number | null>[] = [];
  for (let r = 0; r < count; r++) {
    let at = headerLength + r * recordLength + 1;
    const record: Record<string, string | number | null> = {};
    for (const f of fields) {
      const text = decoder.decode(raw.subarray(at, at + f.length)).trim();
      at += f.length;
      if (f.type === "N" || f.type === "F") {
        const n = Number.parseFloat(text);
        record[f.name] = Number.isFinite(n) ? n : null;
      } else {
        record[f.name] = text === "" ? null : text;
      }
    }
    out.push(record);
  }
  return out;
}

/** A shapefile's records: its shapes with their attributes. */
export function readShapefile(
  shp: ArrayBuffer,
  dbf: ArrayBuffer | null,
  cpg: string | null
): GeoRecord[] {
  const shapes = readShp(shp);
  const rows = dbf ? readDbf(dbf, dbfDecoder(cpg)) : [];
  const out: GeoRecord[] = [];
  shapes.forEach((shape, i) => {
    if (shape) {
      out.push({ ...shape, attributes: rows[i] ?? {} });
    }
  });
  return out;
}
