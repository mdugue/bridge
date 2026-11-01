/**
 * Geometries of a GeoPackage (ADR 0054): its blob is a small header
 * (`GP`, version, flags, the SRS id, an envelope) and then Well-Known
 * Binary. Read: points, lines, polygons and their multi forms and
 * collections, 2D, Z, M and ZM (ISO codes 1000+, 2000+, 3000+, and the
 * EWKB flag bits). The GeoPackage's tables are read by sql.js in the
 * page (design-plan.ts); this is the pure part. No THREE, no DOM.
 */

import type { PlanPoint } from "./plan-geometry";
import type { GeoRecord } from "./shapefile";

/** A GeoPackage blob's SRS id and where its WKB starts. */
export function gpkgHeader(bytes: Uint8Array): { srs: number; wkb: number } {
  if (bytes[0] !== 0x47 || bytes[1] !== 0x50) {
    throw new Error("keine GeoPackage-Geometrie");
  }
  const flags = bytes[3];
  const little = (flags & 1) === 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const srs = view.getInt32(4, little);
  const envelope = [0, 32, 48, 48, 64][(flags >> 1) & 7] ?? 0;
  return { srs, wkb: 8 + envelope };
}

/** Reads WKB from `at`; the shapes (a collection's each) and where it ends. */
function readWkb(
  view: DataView,
  at: number,
  out: { kind: GeoRecord["kind"]; parts: PlanPoint[][] }[]
): number {
  const little = view.getUint8(at) === 1;
  const raw = view.getUint32(at + 1, little);
  // EWKB flags, or ISO's thousands
  const ewkbZ = (raw & 0x8000_0000) !== 0;
  const ewkbM = (raw & 0x4000_0000) !== 0;
  const ewkbSrid = (raw & 0x2000_0000) !== 0;
  const code = raw & 0x0fff_ffff;
  const base = code % 1000;
  const iso = Math.floor(code / 1000);
  const hasZ = ewkbZ || iso === 1 || iso === 3;
  const hasM = ewkbM || iso === 2 || iso === 3;
  const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
  let p = at + 5 + (ewkbSrid ? 4 : 0);
  const point = (): PlanPoint => {
    const x = view.getFloat64(p, little);
    const y = view.getFloat64(p + 8, little);
    const z = hasZ ? view.getFloat64(p + 16, little) : undefined;
    p += dims * 8;
    return z === undefined ? [x, y] : [x, y, z];
  };
  const points = (): PlanPoint[] => {
    const n = view.getUint32(p, little);
    p += 4;
    return Array.from({ length: n }, point);
  };
  if (base === 1) {
    out.push({ kind: "point", parts: [[point()]] });
  } else if (base === 2) {
    out.push({ kind: "line", parts: [points()] });
  } else if (base === 3) {
    const n = view.getUint32(p, little);
    p += 4;
    out.push({
      kind: "polygon",
      parts: Array.from({ length: n }, points),
    });
  } else if (base >= 4 && base <= 7) {
    const n = view.getUint32(p, little);
    p += 4;
    for (let i = 0; i < n; i++) {
      p = readWkb(view, p, out);
    }
  } else {
    throw new Error(`WKB-Typ ${code} wird nicht gelesen`);
  }
  return p;
}

/** A GeoPackage geometry blob's shapes (a multi-geometry's each) and SRS. */
export function readGpkgGeometry(bytes: Uint8Array): {
  srs: number;
  shapes: { kind: GeoRecord["kind"]; parts: PlanPoint[][] }[];
} {
  const { srs, wkb } = gpkgHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shapes: { kind: GeoRecord["kind"]; parts: PlanPoint[][] }[] = [];
  readWkb(view, wkb, shapes);
  return { srs, shapes };
}
