/**
 * Reads a landscape plan from an ASCII DXF (ADR 0054): what a CAD plan
 * says about surfaces, trees and the ground, as plan features
 * (plan-geometry.ts). The plan's content lies in its hatches — a lawn, a
 * paved square, a bed is a hatch on its layer — and its trees are blocks,
 * circles or points on a tree layer. Read:
 *
 * - HATCH: every boundary path (polyline paths with their bulges, edge
 *   paths of lines, arcs and ellipses; spline edges by their control
 *   points), nested into areas with holes;
 * - closed LWPOLYLINE/POLYLINE on a layer that names a class (an
 *   unnamed closed line is as often a kerb or a frame as a surface);
 * - INSERT, CIRCLE and POINT on a tree layer or of a tree block: trees,
 *   their crown a circle's diameter (a block's first circle, scaled);
 * - 3DFACE and polyface meshes: triangles, a planned ground;
 * - 3D polylines' heights: kept, a planned level.
 *
 * Paper space, frames, title blocks, dimensions and text layers are left
 * out. Coordinates are scaled to metres by `$INSUNITS` (none: metres).
 * Binary DXF is not read. No THREE, no DOM.
 */

import { nestRings, type PlanFeature, type PlanPoint } from "./plan-geometry";
import { type PlanClass, planClassOf } from "./plan-classes";

/** One group: its code and its value as written. */
interface Group {
  code: number;
  value: string;
}

/** The DXF's groups, in order. */
function groupsOf(text: string): Group[] {
  const lines = text.split(/\r?\n/);
  const out: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      break;
    }
    out.push({ code, value: lines[i + 1].trim() });
  }
  return out;
}

/** `$INSUNITS` in metres (AutoCAD's codes; 0, none, is taken as metres). */
const UNITS: Readonly<Record<number, number>> = {
  1: 0.0254,
  2: 0.3048,
  4: 0.001,
  5: 0.01,
  6: 1,
  7: 1000,
  10: 0.9144,
  14: 0.1,
};

/** Layers that are drawing furniture, not the plan. */
const NOT_PLAN =
  /rahmen|frame|schriftfeld|titel|title|text|beschrift|bema(ß|ss)ung|dim|legende|legend|nordpfeil|north|viewport|defpoints|raster|grid|plot/i;

/** An entity: its type and its groups up to the next entity. */
interface Entity {
  type: string;
  groups: Group[];
}

/** The entities of a section (`ENTITIES`, or `BLOCKS` with its BLOCK and
 *  ENDBLK markers), in order. */
function sectionEntities(groups: readonly Group[], name: string): Entity[] {
  const out: Entity[] = [];
  let inside = false;
  let current: Entity | null = null;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.code === 0 && g.value === "SECTION") {
      inside = groups[i + 1]?.code === 2 && groups[i + 1].value === name;
      continue;
    }
    if (!inside) {
      continue;
    }
    if (g.code === 0) {
      if (g.value === "ENDSEC") {
        inside = false;
        current = null;
        continue;
      }
      current = { type: g.value, groups: [] };
      out.push(current);
    } else {
      current?.groups.push(g);
    }
  }
  return out;
}

const num = (g: Group | undefined) => (g ? Number.parseFloat(g.value) : 0);
const first = (e: Entity, code: number) =>
  e.groups.find((g) => g.code === code);

/** The points a bulge (tan ¼ of the arc's angle) puts between `a` and `b`. */
function bulgePoints(
  a: readonly [number, number],
  b: readonly [number, number],
  bulge: number
): [number, number][] {
  if (Math.abs(bulge) < 1e-9) {
    return [];
  }
  const angle = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (chord === 0) {
    return [];
  }
  const radius = chord / (2 * Math.sin(angle / 2));
  // the centre: from the chord's middle along its normal
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const h = radius * Math.cos(angle / 2);
  const nx = -(b[1] - a[1]) / chord;
  const ny = (b[0] - a[0]) / chord;
  const cx = mx + nx * h;
  const cy = my + ny * h;
  const start = Math.atan2(a[1] - cy, a[0] - cx);
  const steps = Math.max(2, Math.ceil(Math.abs(angle) / (Math.PI / 12)));
  const r = Math.abs(radius);
  const out: [number, number][] = [];
  for (let i = 1; i < steps; i++) {
    const t = start + (angle * i) / steps;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** Points along an arc (degrees, anticlockwise from `start` to `end`). */
function arcPoints(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  ccw = true
): [number, number][] {
  let a0 = (start * Math.PI) / 180;
  let a1 = (end * Math.PI) / 180;
  if (!ccw) {
    [a0, a1] = [-a0, -a1];
  }
  while (a1 <= a0) {
    a1 += Math.PI * 2;
  }
  const steps = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 12)));
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    out.push([
      cx + r * Math.cos(t),
      cy + r * (ccw ? Math.sin(t) : -Math.sin(t)),
    ]);
  }
  return out;
}

/** A polyline's vertices with its bulges filled in. */
function withBulges(
  vertices: readonly { x: number; y: number; z?: number; bulge: number }[],
  closed: boolean
): PlanPoint[] {
  const out: PlanPoint[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    out.push(v.z === undefined ? [v.x, v.y] : [v.x, v.y, v.z]);
    const next = vertices[i + 1] ?? (closed ? vertices[0] : null);
    if (next && v.bulge) {
      for (const [x, y] of bulgePoints([v.x, v.y], [next.x, next.y], v.bulge)) {
        out.push(v.z === undefined ? [x, y] : [x, y, v.z]);
      }
    }
  }
  return out;
}

/** An LWPOLYLINE's ring (null: open). */
function lwpolyline(e: Entity): PlanPoint[] | null {
  const closed = (num(first(e, 70)) & 1) === 1;
  const elevation = num(first(e, 38));
  const vertices: { x: number; y: number; z?: number; bulge: number }[] = [];
  for (const g of e.groups) {
    if (g.code === 10) {
      vertices.push({
        x: Number.parseFloat(g.value),
        y: 0,
        z: elevation || undefined,
        bulge: 0,
      });
    } else if (g.code === 20 && vertices.length > 0) {
      vertices[vertices.length - 1].y = Number.parseFloat(g.value);
    } else if (g.code === 42 && vertices.length > 0) {
      vertices[vertices.length - 1].bulge = Number.parseFloat(g.value);
    }
  }
  const ring = closed ? withBulges(vertices, true) : [];
  return ring.length >= 3 ? ring : null;
}

/** A VERTEX entity's point and flags. */
function vertexOf(e: Entity) {
  return {
    x: num(first(e, 10)),
    y: num(first(e, 20)),
    z: num(first(e, 30)) || undefined,
    bulge: num(first(e, 42)),
    flags: num(first(e, 70)),
    face: [71, 72, 73, 74]
      .map((c) => Math.abs(num(first(e, c))))
      .filter((i) => i > 0),
  };
}

/** A POLYLINE with its VERTEX entities: a ring, or a polyface mesh's
 *  triangles. */
function polyline(
  head: Entity,
  vertices: readonly Entity[]
):
  | { ring: PlanPoint[] }
  | { triangles: [PlanPoint, PlanPoint, PlanPoint][] }
  | null {
  const flags = num(first(head, 70));
  const all = vertices.map(vertexOf);
  if (flags & 64) {
    const points = all.filter((v) => !(v.flags & 128) || v.flags & 64);
    const faces = all.filter((v) => v.flags & 128 && !(v.flags & 64));
    const p = (i: number): PlanPoint => {
      const v = points[i - 1];
      return [v.x, v.y, v.z];
    };
    const triangles: [PlanPoint, PlanPoint, PlanPoint][] = [];
    for (const f of faces) {
      if (f.face.length >= 3 && f.face.every((i) => i <= points.length)) {
        triangles.push([p(f.face[0]), p(f.face[1]), p(f.face[2])]);
        if (f.face.length === 4) {
          triangles.push([p(f.face[0]), p(f.face[2]), p(f.face[3])]);
        }
      }
    }
    return { triangles };
  }
  if (flags & 16) {
    return null;
  }
  const ring = (flags & 1) === 1 ? withBulges(all, true) : [];
  return ring.length >= 3 ? { ring } : null;
}

/** A 3DFACE's one or two triangles. */
function face3d(e: Entity): [PlanPoint, PlanPoint, PlanPoint][] {
  const corner = (k: number): PlanPoint => [
    num(first(e, 10 + k)),
    num(first(e, 20 + k)),
    num(first(e, 30 + k)),
  ];
  const [a, b, c, d] = [corner(0), corner(1), corner(2), corner(3)];
  const same = (p: PlanPoint, q: PlanPoint) =>
    p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  return same(c, d)
    ? [[a, b, c]]
    : [
        [a, b, c],
        [a, c, d],
      ];
}

/** Reads a hatch's boundary paths, in order, as rings. */
function hatchRings(e: Entity): PlanPoint[][] {
  const g = e.groups;
  const elevation = num(g.find((x) => x.code === 30));
  const z = elevation || undefined;
  const rings: PlanPoint[][] = [];
  let i = g.findIndex((x) => x.code === 91);
  if (i < 0) {
    return rings;
  }
  const paths = Number.parseInt(g[i].value, 10);
  i++;
  const at = (code: number) => {
    while (i < g.length && g[i].code !== code) {
      i++;
    }
    return i < g.length ? Number.parseFloat(g[i++].value) : 0;
  };
  for (let p = 0; p < paths && i < g.length; p++) {
    const type = at(92);
    const ring: PlanPoint[] = [];
    if (type & 2) {
      const hasBulge = at(72) !== 0;
      at(73);
      const n = at(93);
      const vertices: { x: number; y: number; z?: number; bulge: number }[] =
        [];
      for (let k = 0; k < n; k++) {
        const x = at(10);
        const y = at(20);
        const bulge = hasBulge ? at(42) : 0;
        vertices.push({ x, y, z, bulge });
      }
      ring.push(...withBulges(vertices, true));
    } else {
      const edges = at(93);
      for (let k = 0; k < edges; k++) {
        ring.push(...hatchEdge(at, z));
      }
    }
    if (ring.length >= 3) {
      rings.push(ring);
    }
  }
  return rings;
}

/** One edge of a hatch's edge path, its points (the edge's start first). */
function hatchEdge(
  at: (code: number) => number,
  z: number | undefined
): PlanPoint[] {
  const pt = (p: [number, number]): PlanPoint =>
    z === undefined ? p : [p[0], p[1], z];
  const kind = at(72);
  if (kind === 1) {
    const a: [number, number] = [at(10), at(20)];
    at(11);
    at(21);
    return [pt(a)];
  }
  if (kind === 2) {
    const cx = at(10);
    const cy = at(20);
    const r = at(40);
    const start = at(50);
    const end = at(51);
    const ccw = at(73) !== 0;
    return arcPoints(cx, cy, r, start, end, ccw).slice(0, -1).map(pt);
  }
  if (kind === 3) {
    const cx = at(10);
    const cy = at(20);
    const mx = at(11);
    const my = at(21);
    const ratio = at(40);
    const start = at(50);
    const end = at(51);
    const ccw = at(73) !== 0;
    const major = Math.hypot(mx, my);
    const turn = Math.atan2(my, mx);
    return arcPoints(0, 0, 1, start, end, ccw)
      .slice(0, -1)
      .map(([u, v]) => {
        const x = u * major;
        const y = v * major * ratio;
        return pt([
          cx + x * Math.cos(turn) - y * Math.sin(turn),
          cy + x * Math.sin(turn) + y * Math.cos(turn),
        ]);
      });
  }
  // a spline: its control points stand in for its curve
  at(94);
  at(73);
  at(74);
  const knots = at(95);
  const controls = at(96);
  for (let k = 0; k < knots; k++) {
    at(40);
  }
  const out: PlanPoint[] = [];
  for (let k = 0; k < controls; k++) {
    out.push(pt([at(10), at(20)]));
  }
  return out;
}

/** The first circle's radius in each block (a tree symbol's crown). */
function blockCrowns(groups: readonly Group[]): Map<string, number> {
  const crowns = new Map<string, number>();
  let block: string | null = null;
  for (const e of sectionEntities(groups, "BLOCKS")) {
    if (e.type === "BLOCK") {
      block = first(e, 2)?.value ?? null;
    } else if (e.type === "ENDBLK") {
      block = null;
    } else if (e.type === "CIRCLE" && block && !crowns.has(block)) {
      crowns.set(block, num(first(e, 40)));
    }
  }
  return crowns;
}

/** What a plan read from a DXF holds. */
export interface DxfPlan {
  features: PlanFeature[];
  /** the drawing unit (m) */
  unit: number;
  /** the layers that gave a class, and those that did not */
  classified: string[];
  unclassified: string[];
}

/** Scales a point by the drawing unit. */
const scaled =
  (unit: number) =>
  (p: PlanPoint): PlanPoint =>
    p[2] === undefined
      ? [p[0] * unit, p[1] * unit]
      : [p[0] * unit, p[1] * unit, p[2] * unit];

/** A ring as a circle: `n` points about (cx, cy). */
function circleRing(cx: number, cy: number, r: number, z?: number, n = 24) {
  return Array.from({ length: n }, (_, i): PlanPoint => {
    const t = (i / n) * Math.PI * 2;
    return z === undefined
      ? [cx + r * Math.cos(t), cy + r * Math.sin(t)]
      : [cx + r * Math.cos(t), cy + r * Math.sin(t), z];
  });
}

/** What reading the entities collects. */
interface Reading {
  features: PlanFeature[];
  classified: Set<string>;
  unclassified: Set<string>;
  unit: number;
  crowns: ReadonlyMap<string, number>;
}

/** An entity's class from its layer (and a block's name), noted. */
function classOf(r: Reading, e: Entity, extra?: string): PlanClass | null {
  const layer = first(e, 8)?.value ?? "0";
  // a block's name says more than the layer it was inserted on
  const cls = planClassOf([extra, layer]);
  (cls ? r.classified : r.unclassified).add(layer);
  return cls;
}

/** Areas of `cls` from rings in drawing units. */
function addArea(r: Reading, cls: PlanClass | null, rings: PlanPoint[][]) {
  const s = scaled(r.unit);
  for (const nested of nestRings(rings.map((ring) => ring.map(s)))) {
    r.features.push({ kind: "area", cls, rings: nested });
  }
}

/** Triangles of `cls` from points in drawing units. */
function addMesh(
  r: Reading,
  cls: PlanClass,
  triangles: readonly (readonly [PlanPoint, PlanPoint, PlanPoint])[]
) {
  const s = scaled(r.unit);
  r.features.push({
    kind: "mesh",
    cls,
    triangles: triangles.map(([a, b, c]) => [s(a), s(b), s(c)] as const),
  });
}

/** Reads the entity at `k` (a POLYLINE with its vertices); the index of
 *  the last entity it took. */
function readEntity(
  r: Reading,
  entities: readonly Entity[],
  k: number
): number {
  const e = entities[k];
  if (e.type === "HATCH") {
    addArea(r, classOf(r, e), hatchRings(e));
  } else if (e.type === "LWPOLYLINE") {
    const ring = lwpolyline(e);
    const cls = classOf(r, e);
    if (ring && cls && cls !== "tree") {
      addArea(r, cls, [ring]);
    }
  } else if (e.type === "POLYLINE") {
    const vertices: Entity[] = [];
    let last = k;
    while (entities[last + 1]?.type === "VERTEX") {
      vertices.push(entities[++last]);
    }
    const read = polyline(e, vertices);
    const cls = classOf(r, e);
    if (read && "triangles" in read) {
      addMesh(r, cls ?? "terrain", read.triangles);
    } else if (read && cls && cls !== "tree") {
      addArea(r, cls, [read.ring]);
    }
    return last;
  } else if (e.type === "3DFACE") {
    addMesh(r, classOf(r, e) ?? "terrain", face3d(e));
  } else {
    treeOrRound(r, e);
  }
  return k;
}

/** Reads an ASCII DXF as a landscape plan. */
export function readDxf(text: string): DxfPlan {
  const groups = groupsOf(text);
  const units = groups.findIndex(
    (g, i) => g.code === 9 && g.value === "$INSUNITS" && groups[i + 1]
  );
  const r: Reading = {
    features: [],
    classified: new Set(),
    unclassified: new Set(),
    unit:
      units >= 0
        ? (UNITS[Number.parseInt(groups[units + 1].value, 10)] ?? 1)
        : 1,
    crowns: blockCrowns(groups),
  };
  const entities = sectionEntities(groups, "ENTITIES");
  for (let k = 0; k < entities.length; k++) {
    const e = entities[k];
    const layer = first(e, 8)?.value ?? "0";
    // paper space and drawing furniture are not the plan
    if (num(first(e, 67)) !== 1 && !NOT_PLAN.test(layer)) {
      k = readEntity(r, entities, k);
    }
  }
  return {
    features: mergeMeshes(r.features),
    unit: r.unit,
    classified: [...r.classified],
    unclassified: [...r.unclassified].filter((l) => !r.classified.has(l)),
  };
}

/** A tree from an INSERT, CIRCLE or POINT on a tree layer (or of a tree
 *  block); a circle on a surface layer is a round area. */
function treeOrRound(r: Reading, e: Entity): void {
  if (e.type !== "INSERT" && e.type !== "CIRCLE" && e.type !== "POINT") {
    return;
  }
  const block = e.type === "INSERT" ? first(e, 2)?.value : undefined;
  const cls = classOf(r, e, block);
  const x = num(first(e, 10));
  const y = num(first(e, 20));
  const z = num(first(e, 30)) || undefined;
  if (cls === "tree") {
    let crown: number | null = null;
    if (e.type === "CIRCLE") {
      crown = 2 * num(first(e, 40)) * r.unit;
    } else if (block && r.crowns.has(block)) {
      const scale = Math.abs(num(first(e, 41)) || 1);
      crown = 2 * (r.crowns.get(block) ?? 0) * scale * r.unit;
    }
    r.features.push({
      kind: "tree",
      at: scaled(r.unit)(z === undefined ? [x, y] : [x, y, z]),
      // a symbol drawn at a glyph's size, not the crown's: the default
      crown: crown !== null && crown >= 1 && crown <= 40 ? crown : null,
    });
  } else if (e.type === "CIRCLE" && cls) {
    addArea(r, cls, [circleRing(x, y, num(first(e, 40)), z)]);
  }
}

/** The plan's meshes of one class as one feature. */
function mergeMeshes(features: readonly PlanFeature[]): PlanFeature[] {
  type Triangle = readonly [PlanPoint, PlanPoint, PlanPoint];
  const meshes = new Map<PlanClass | null, Triangle[]>();
  const out: PlanFeature[] = [];
  for (const f of features) {
    if (f.kind === "mesh") {
      const list = meshes.get(f.cls) ?? [];
      list.push(...f.triangles);
      meshes.set(f.cls, list);
    } else {
      out.push(f);
    }
  }
  for (const [cls, triangles] of meshes) {
    out.push({ kind: "mesh", cls, triangles });
  }
  return out;
}
