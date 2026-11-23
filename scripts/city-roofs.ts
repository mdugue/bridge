/**
 * The roofs the building bake rebuilds (scripts/bake-city-mesh.ts): an
 * object whose LoD2 roof misses DOM1 wears its measured parts
 * (`withMeasuredRoofs`, scripts/measured-roofs.ts), and a roof on posts
 * LoD2 draws as a block is opened (`withOpenRoofs`). No DOM.
 */
import { cm, triangulateXY } from "./city-bake";
import { rootOf } from "./city-lod2";
import { inheritedAttributes } from "../lib/city/building-tint";
import type { RoofColours } from "../lib/city/building-tint";
import { hasObjectFlag, OBJECT_FLAG_FLAT_ROOF } from "../lib/city/city-mesh";
import type { CityObjectRow } from "../lib/city/city-mesh";
import type { MeasuredRoofFeature } from "../lib/city/features";
import {
  clipAbove,
  isOpenRoof,
  MIN_CLEAR_M,
  postsMesh,
  roofDepth,
  roofPosts,
} from "../lib/city/open-roofs";
import type { CityJsonDocument } from "../lib/city/types";
import { measuredRoofMesh, measuredRoofsById } from "./measured-roofs";
import type { PrismMesh } from "./measured-roofs";
import { streamWriter } from "./vertex-stream";
import type { CityVertices } from "./vertex-stream";

/** The objects (by index in `keys`) that have measured parts, with them. */
function replacedObjects(
  keys: readonly string[],
  byId: ReadonlyMap<string, MeasuredRoofFeature[]>
): Map<number, MeasuredRoofFeature[]> {
  const replaced = new Map<number, MeasuredRoofFeature[]>();
  for (let index = 0; index < keys.length; index += 1) {
    const id = keys[index];
    const parts = byId.get(id);
    if (parts) {
      replaced.set(index, parts);
    }
  }
  return replaced;
}

/** The roof colour rows read for an object's parts, by part: a colour read
 *  for another roofs file's part (its level differs) is not this part's. */
function ownPartColours(
  rows: readonly (readonly number[])[] | undefined,
  parts: readonly MeasuredRoofFeature[]
): Map<number, number[]> {
  return new Map(
    (rows ?? [])
      .filter(
        (p) =>
          Math.abs(p[1] - (parts[p[0]]?.properties?.z ?? Number.NaN)) < 0.01
      )
      .map((p): [number, number[]] => [p[0], p.slice(2, 5)])
  );
}

/** Per vertex of a measured roof mesh, its roof colour (a roof's own where
 *  one was read, else none). */
function meshRoofRgb(
  mesh: PrismMesh,
  own: ReadonlyMap<number, number[]>
): number[] {
  const out: number[] = [];
  for (let k = 0; k < mesh.parts.length; k += 1) {
    const part = mesh.parts[k];
    const c = mesh.isRoof[k] === 1 ? own.get(part) : undefined;
    out.push(...(c?.length === 3 ? c : FLAT_RGB));
  }
  return out;
}

/**
 * The vertex stream with every object that has measured parts rebuilt:
 * its LoD2 triangles dropped, its prisms appended under the same object id
 * (so its table row, picking and demolish stay), standing on the lowest
 * vertex of its LoD2 shell, a part's roof in its own colour where the roof
 * colour bake read it apart (`RoofColours.parts`, kept only where the
 * part's level matches the one read). A part id the tile does not hold is
 * ignored.
 */
export function withMeasuredRoofs(
  v: CityVertices,
  keys: readonly string[],
  offset: { cx: number; cy: number },
  features: readonly MeasuredRoofFeature[],
  colours?: Partial<RoofColours>
): CityVertices {
  const replaced = replacedObjects(keys, measuredRoofsById(features));
  if (replaced.size === 0) {
    return v;
  }
  const base = new Map<number, number>();
  // rebuilt, the stream carries a normal and a roof colour a vertex and no
  // loader surface (the roof steps and face colours are read by now)
  const out = streamWriter(v, {
    normals: true,
    roofRgb: true,
    surfaces: false,
  });
  // the kept vertices go over in runs
  let run = 0;
  for (let i = 0; i < v.objectIds.length; i += 1) {
    const idx = v.objectIds[i];
    if (replaced.has(idx)) {
      const z = v.positions[i * 3 + 2];
      base.set(idx, Math.min(base.get(idx) ?? z, z));
      out.copy(run, i - run);
      run = i + 1;
    }
  }
  out.copy(run, v.objectIds.length - run);
  for (const [index, parts] of replaced) {
    const z = base.get(index);
    if (z === undefined) {
      continue;
    }
    const mesh = measuredRoofMesh(parts, z, offset);
    out.add(mesh.positions, index, {
      isRoof: mesh.isRoof,
      normals: mesh.normals,
      roofRgb: meshRoofRgb(
        mesh,
        ownPartColours(colours?.parts?.[keys[index]], parts)
      ),
    });
  }
  return out.done();
}

/** A roof on posts has no facade to dress: no storey lines, no plinth or
 *  cornices on its posts (the flat roof's gate), no windows (WINDOWLESS). */
export function markOpenRoofs(
  objects: CityObjectRow[],
  open: ReadonlySet<number>
): void {
  for (const i of open) {
    const o = objects[i];
    o.storeyH = cm(o.eaveH + 1);
    if (!hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF)) {
      o.flags += OBJECT_FLAG_FLAT_ROOF;
    }
  }
}

/** No roof colour of its own: the object's. */
const FLAT_RGB = [Number.NaN, Number.NaN, Number.NaN];

/** The objects LoD2 draws as a block that are a roof on posts: their own
 *  ALKIS function, or their Building's, an Überdachung or a Carport
 *  (lib/city/open-roofs.ts `isOpenRoof`). */
export function openRoofObjects(
  doc: CityJsonDocument,
  keys: string[]
): Set<number> {
  const out = new Set<number>();
  for (let index = 0; index < keys.length; index += 1) {
    const id = keys[index];
    const root = doc.CityObjects[keys[rootOf(doc, keys, index)]];
    const attrs = inheritedAttributes(
      doc.CityObjects[id].attributes ?? {},
      root.attributes
    );
    if (isOpenRoof(attrs.function)) {
      out.add(index);
    }
  }
  return out;
}

/** A triangle's upward unit normal z (flat x, y, z triples). */
function normalZ(t: readonly number[]): number {
  const ux = t[3] - t[0];
  const uy = t[4] - t[1];
  const uz = t[5] - t[2];
  const wx = t[6] - t[0];
  const wy = t[7] - t[1];
  const wz = t[8] - t[2];
  const nx = uy * wz - uz * wy;
  const ny = uz * wx - ux * wz;
  const nz = ux * wy - uy * wx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? nz / len : 0;
}

/** Each object's lowest vertex and lowest roof vertex. */
function objectLevels(
  v: CityVertices,
  of: ReadonlySet<number>
): Map<number, { base: number; roof: number }> {
  const out = new Map<number, { base: number; roof: number }>();
  for (let i = 0; i < v.objectIds.length; i += 1) {
    const o = v.objectIds[i];
    if (!of.has(o)) {
      continue;
    }
    const z = v.positions[i * 3 + 2];
    const l = out.get(o) ?? { base: z, roof: Number.POSITIVE_INFINITY };
    l.base = Math.min(l.base, z);
    if (v.isRoof[i] === 1) {
      l.roof = Math.min(l.roof, z);
    }
    out.set(o, l);
  }
  return out;
}

/**
 * The vertex stream with every roof on posts LoD2 draws as a block
 * (`openRoofObjects`) opened, as an OSM roof is drawn (lib/city/
 * open-roofs.ts): its roof kept, its walls cut a slab's depth (`roofDepth`
 * of its footprint) under its lowest roof vertex, its floor dropped and its
 * footprint laid there facing down instead, and posts from its base up to
 * it (`roofPosts`) — a platform under one shows, a fuel station's pumps
 * stand under it. Its row stays (picking, demolish, its facts), and so
 * does its base: the posts reach it. One whose roof stands under
 * `MIN_CLEAR_M` over its base stays a block, and so does one without an
 * outline (cut, it would stand open, its underside laid nowhere).
 * `footprints`: each object's outlines (EPSG), recentered by `offset`.
 */
export function withOpenRoofs(
  v: CityVertices,
  open: ReadonlySet<number>,
  footprints: readonly (readonly [number, number][])[][],
  offset: { cx: number; cy: number }
): CityVertices {
  const levels = objectLevels(v, open);
  const cut = new Map<number, number>();
  for (const [o, l] of levels) {
    const rings = footprints[o] ?? [];
    if (rings.length === 0) {
      continue; // no outline to lay its underside on: it stays a block
    }
    const area = rings.reduce((a, r) => a + Math.abs(ringArea(r)), 0);
    const under = l.roof - roofDepth(area);
    if (Number.isFinite(under) && under - l.base >= MIN_CLEAR_M) {
      cut.set(o, under);
    }
  }
  if (cut.size === 0) {
    return v;
  }
  const out = streamWriter(v);
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    const o = v.objectIds[t];
    const under = cut.get(o);
    if (under === undefined || v.isRoof[t] === 1) {
      out.copy(t, 3);
      continue;
    }
    const tri = Array.from(v.positions.subarray(t * 3, t * 3 + 9));
    // the floor goes: the footprint is laid at the slab's underside
    if (normalZ(tri) < -0.9) {
      continue;
    }
    out.add(clipAbove(tri, under), o, { like: t });
  }
  for (const [o, under] of cut) {
    const base = levels.get(o)?.base ?? under;
    for (const ring of footprints[o] ?? []) {
      const local = ring.map(([x, y]): [number, number] => [
        x - offset.cx,
        y - offset.cy,
      ]);
      out.add(undersideOf(local, under), o);
      out.add(postsMesh(roofPosts([local]), base, under).positions, o);
    }
  }
  return out.done();
}

/** A ring's signed area (counter-clockwise positive). */
function ringArea(ring: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** A footprint's triangles at height `z`, facing down. */
function undersideOf(ring: readonly [number, number][], z: number): number[] {
  const last = ring.at(-1);
  const open =
    last && ring.length > 1 && ring[0][0] === last[0] && ring[0][1] === last[1]
      ? ring.slice(0, -1)
      : ring;
  const out: number[] = [];
  const tris = triangulateXY(open.flat(), []);
  for (let k = 0; k + 2 < tris.length; k += 3) {
    const [a, b, c] = [open[tris[k]], open[tris[k + 1]], open[tris[k + 2]]];
    const ccw = ringArea([a, b, c]) > 0;
    // clockwise seen from above faces down
    const [p, q] = ccw ? [c, b] : [b, c];
    out.push(a[0], a[1], z, p[0], p[1], z, q[0], q[1], z);
  }
  return out;
}
