/**
 * OSM's passages through the buildings in the building bake
 * (scripts/bake-city-mesh.ts): planned on the storeys (`passagePlans`),
 * then cut through the dressed walls and lined (`withPassages`), last of
 * all. No DOM.
 */
import { cm, triangulateXY } from "./city-bake";
import type { BakedCityMesh } from "./city-bake";
import {
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_PASSAGE,
} from "../lib/city/city-mesh";
import type { CityObjectRow } from "../lib/city/city-mesh";
import {
  cutOut,
  passageHeight,
  passageLining,
  passageRegions,
  touches,
} from "../lib/city/building-passages";
import type { PassageAxis, Plane } from "../lib/city/building-passages";
import { SINK } from "../lib/city/ground-join";
import type {
  DoorFeature,
  PassageFeature,
  PassagePart,
} from "../lib/city/features";
import { DOOR_SLOT, doorClassWidth, NO_DOOR } from "../lib/city/windows";
import type { FacadeDoor } from "../lib/city/windows";
import { copyVertices, emptyStream } from "./vertex-stream";
import type { CityVertices } from "./vertex-stream";

/** A passage the bake opens (`passagePlans`), recentred: its axis and the
 *  volume it takes, the LoD2 objects it runs through with their shares,
 *  and the box (x0, y0, z0, x1, y1, z1) it can touch. */
export interface PassagePlan {
  axis: PassageAxis;
  box: readonly [number, number, number, number, number, number];
  hosts: { object: number; part: PassagePart }[];
  regions: Plane[][];
}

/** The widest door a `_FACADE` slot holds (m): a wider portal keeps the
 *  windows off its middle that far, the rest of it is open wall anyway. */
const PORTAL_W_MAX = doorClassWidth(DOOR_SLOT.widths - 1);
/** An OSM door this close to a passage's opening (m past its half width)
 *  stands in it: none is drawn there. */
const PORTAL_DOOR_M = 0.3;

/**
 * The passages of the tile (pipeline/bake/passages.py) as the bake opens
 * them: the LoD2 objects of this tile each runs through, its clear height
 * from their eaves and storeys (lib/city/building-passages.ts
 * `passageHeight`) — none where they stand too low — and its volume.
 */
export function passagePlans(
  objects: readonly CityObjectRow[],
  keys: readonly string[],
  passages: readonly PassageFeature[],
  offset: { cx: number; cy: number }
): PassagePlan[] {
  const index = new Map(keys.map((id, i) => [id, i]));
  const local = (q: readonly number[]): [number, number] => [
    q[0] - offset.cx,
    q[1] - offset.cy,
  ];
  return passages.flatMap((f) => {
    const p = f.properties;
    if (!p || f.geometry.coordinates.length < 2) {
      return [];
    }
    const hosts = Object.entries(p.of).flatMap(([id, part]) => {
      const object = index.get(id);
      const o = object === undefined ? undefined : objects[object];
      if (
        object === undefined ||
        !o ||
        (o.source ?? OBJECT_SOURCE_LOD2) !== OBJECT_SOURCE_LOD2
      ) {
        return [];
      }
      return [
        {
          object,
          part: {
            portals: part.portals.map(
              ([x, y, nx, ny]): [number, number, number, number] => [
                x - offset.cx,
                y - offset.cy,
                nx,
                ny,
              ]
            ),
            roof: part.roof.map((r) => r.map(local)),
            sides: part.sides.map((r) => r.map(local)),
          },
        },
      ];
    });
    const h = passageHeight(
      p.kind,
      p.h,
      Math.max(...p.z),
      hosts.map(({ object }) => ({
        eaveZ: objects[object].baseZ + objects[object].eaveH,
        storeyH: objects[object].storeyH,
      }))
    );
    if (h === null) {
      return [];
    }
    const axis: PassageAxis = {
      axis: f.geometry.coordinates.map(local),
      ground: p.z,
      h,
      w: p.w,
    };
    const xs = axis.axis.map((q) => q[0]);
    const ys = axis.axis.map((q) => q[1]);
    const box = [
      Math.min(...xs) - p.w,
      Math.min(...ys) - p.w,
      Math.min(...p.z) - SINK.wall,
      Math.max(...xs) + p.w,
      Math.max(...ys) + p.w,
      Math.max(...p.z) + h,
    ] as const;
    return [{ axis, box, hosts, regions: passageRegions(axis) }];
  });
}

/** The passages' portals as doors on their walls (lib/city/windows.ts
 *  `FacadeDoor`): the ground floor's windows keep off them. */
export function portalDoors(plans: readonly PassagePlan[]): FacadeDoor[] {
  return plans.flatMap((plan) =>
    plan.hosts.flatMap(({ object, part }) =>
      part.portals.map(([x, y, nx, ny]) => ({
        object,
        at: [x, y] as [number, number],
        n: [nx, ny] as [number, number],
        w: Math.min(plan.axis.w, PORTAL_W_MAX),
      }))
    )
  );
}

/** The distance (m) from plan point `q` to a polyline. */
function toPolyline(
  q: readonly [number, number],
  line: readonly (readonly [number, number])[]
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k + 1 < line.length; k += 1) {
    const [a, b] = [line[k], line[k + 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t =
      l2 > 0
        ? Math.min(
            Math.max(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2, 0),
            1
          )
        : 0;
    best = Math.min(
      best,
      Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy)
    );
  }
  return best;
}

/** OSM's doors without those that stand in a passage's opening on their
 *  own building (an entrance mapped where the passage meets the wall): the
 *  opening is the way in. */
export function outsidePassages(
  doors: readonly DoorFeature[],
  plans: readonly PassagePlan[],
  keys: readonly string[],
  baked: Pick<BakedCityMesh, "objects" | "offset">
): DoorFeature[] {
  if (plans.length === 0) {
    return [...doors];
  }
  const index = new Map(keys.map((id, i) => [id, i]));
  const { cx, cy } = baked.offset;
  return doors.filter((f) => {
    const object = f.properties ? index.get(f.properties.of) : undefined;
    const root = object === undefined ? undefined : baked.objects[object]?.root;
    const [x, y] = f.geometry.coordinates;
    return !plans.some(
      (plan) =>
        plan.hosts.some(({ object: h }) => baked.objects[h].root === root) &&
        toPolyline([x - cx, y - cy], plan.axis.axis) <=
          plan.axis.w / 2 + PORTAL_DOOR_M
    );
  });
}

/** Whether triangle `t` of the stream can reach into `box`. */
function inBox(
  p: ArrayLike<number>,
  t: number,
  box: PassagePlan["box"]
): boolean {
  for (let c = 0; c < 3; c += 1) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < 3; k += 1) {
      const x = p[3 * (t + k) + c];
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (hi < box[c] || lo > box[c + 3]) {
      return false;
    }
  }
  return true;
}

/** Whether two boxes (x0, y0, z0, x1, y1, z1) overlap. */
function boxesMeet(a: PassagePlan["box"], b: PassagePlan["box"]): boolean {
  return [0, 1, 2].every((c) => a[c] <= b[c + 3] && b[c] <= a[c + 3]);
}

/** Triangles (flat x, y, z) cut to what lies outside the plans' volumes. */
function outsideOf(
  positions: readonly number[],
  plans: readonly PassagePlan[]
): number[] {
  if (plans.length === 0) {
    return [...positions];
  }
  const out: number[] = [];
  for (let k = 0; k + 8 < positions.length; k += 9) {
    const tri = positions.slice(k, k + 9);
    const regions = plans.flatMap((plan) =>
      plan.regions.filter((r) => touches(tri, r))
    );
    out.push(...(regions.length > 0 ? cutOut(tri, regions) : tri));
  }
  return out;
}

/**
 * The passages cut open (lib/city/building-passages.ts): every triangle
 * but a roof's of the building trees each runs through — the LoD2 walls
 * and floor, and the plinths, doors and shopfronts laid on them — cut to
 * what lies outside its volume, and per object its lining (walls along
 * it, its ceiling) appended as a part of the object (`OBJECT_SOURCE_
 * PASSAGE`: its own colour, the host's, no windows, no eave). Last of the
 * bake: the windows and doors were placed on the whole walls, and a cut
 * piece carries its triangle's place on its wall (`_FACADE`) and normal.
 */
export function withPassages(
  baked: Pick<BakedCityMesh, "objects" | "vertices">,
  plans: readonly PassagePlan[]
): void {
  if (plans.length === 0) {
    return;
  }
  const { objects } = baked;
  const v = baked.vertices;
  const byRoot = new Map<number, PassagePlan[]>();
  for (const plan of plans) {
    for (const root of new Set(plan.hosts.map((h) => objects[h.object].root))) {
      byRoot.set(root, [...(byRoot.get(root) ?? []), plan]);
    }
  }
  const pieces = new Map<number, number[]>();
  const p = v.positions;
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    const near =
      v.isRoof[t] === 1
        ? undefined
        : byRoot.get(objects[v.objectIds[t]]?.root ?? -1);
    if (!near) {
      continue;
    }
    // (most of a tree's triangles lie in no passage's box: no copy of them)
    const boxed = near.filter((plan) => inBox(p, t, plan.box));
    if (boxed.length === 0) {
      continue;
    }
    const tri = Array.from(p.subarray(3 * t, 3 * t + 9));
    const regions = boxed.flatMap((plan) =>
      plan.regions.filter((r) => touches(tri, r))
    );
    if (regions.length > 0) {
      pieces.set(t, cutOut(tri, regions));
    }
  }
  const linings: { id: number; positions: number[] }[] = [];
  for (const plan of plans) {
    // a passage crossing it, or beside it through one gateway: its lining
    // keeps out of that one's opening
    const crossing = plans.filter(
      (other) => other !== plan && boxesMeet(other.box, plan.box)
    );
    for (const { object, part } of plan.hosts) {
      const positions = outsideOf(
        passageLining(plan.axis, part, triangulateXY),
        crossing
      );
      if (positions.length === 0) {
        continue;
      }
      let base = Number.POSITIVE_INFINITY;
      let top = Number.NEGATIVE_INFINITY;
      for (let i = 2; i < positions.length; i += 3) {
        base = Math.min(base, positions[i]);
        top = Math.max(top, positions[i]);
      }
      const host = { ...objects[object] };
      delete host.windows;
      const above = cm(top - base + 1);
      linings.push({ id: objects.length, positions });
      objects.push({
        ...host,
        building: false,
        baseZ: cm(base),
        // above its top: no eave stroke, no storey band in it
        eaveH: above,
        storeyH: above,
        glow: 0,
        // the host's plaster runs on in, none of its OSM looks
        flags: OBJECT_FLAG_OWN_COLOUR,
        source: OBJECT_SOURCE_PASSAGE,
        footprints: [],
      });
    }
  }
  baked.vertices = withCuts(v, pieces, linings);
}

/** The stream with triangle `t`'s vertices replaced by `pieces.get(t)`
 *  (flat x, y, z: its pieces, none, or itself cut), each new vertex
 *  carrying its triangle's attributes — its normal and place on its wall
 *  (`_FACADE`'s first number) interpolated, the rest the triangle's — and
 *  `parts` appended (flat, no roof, no wall of the facade's). */
function withCuts(
  v: CityVertices,
  pieces: ReadonlyMap<number, readonly number[]>,
  parts: readonly { id: number; positions: readonly number[] }[]
): CityVertices {
  const count = v.objectIds.length;
  let total = count;
  for (const [, xyz] of pieces) {
    total += xyz.length / 3 - 3;
  }
  for (const part of parts) {
    total += part.positions.length / 3;
  }
  const out = emptyStream(v, total);
  const { positions, objectIds, normals, facade } = out;
  const noDoor = Math.round(NO_DOOR * 32_767);
  let at = 0;
  // the old stream's vertices from `run` up to `end`, as they were, to
  // `at`: the uncut triangles go over in runs, not vertex by vertex (a
  // tile's millions of vertices were as many subarrays for the collector)
  let run = 0;
  const flush = (end: number) => {
    copyVertices(v, run, end - run, out, at);
    at += end - run;
  };
  for (const t of [...pieces.keys()].sort((a, b) => a - b)) {
    flush(t);
    run = t + 3;
    const xyz = pieces.get(t) ?? [];
    const bary = barycentric(v.positions, t);
    for (let k = 0; k + 2 < xyz.length; k += 3) {
      const w = bary(xyz[k], xyz[k + 1], xyz[k + 2]);
      copyVertices(v, t, 1, out, at);
      positions[3 * at] = xyz[k];
      positions[3 * at + 1] = xyz[k + 1];
      positions[3 * at + 2] = xyz[k + 2];
      if (normals && v.normals) {
        normals.set(blend(v.normals, 3, t, w, true), 3 * at);
      }
      if (facade && v.facade) {
        facade[4 * at] = Math.round(blend(v.facade, 4, t, w, false)[0]);
      }
      at += 1;
    }
  }
  flush(count);
  for (const part of parts) {
    const n = part.positions.length / 3;
    positions.set(part.positions, 3 * at);
    objectIds.fill(part.id, at, at + n);
    if (facade) {
      for (let i = at; i < at + n; i += 1) {
        facade[4 * i + 2] = noDoor;
        facade[4 * i + 3] = noDoor;
      }
    }
    at += n;
  }
  return out;
}

/** Triangle `t`'s barycentric weights of a point in its plane. */
function barycentric(
  p: ArrayLike<number>,
  t: number
): (x: number, y: number, z: number) => [number, number, number] {
  const a = [p[3 * t], p[3 * t + 1], p[3 * t + 2]];
  const e1 = [p[3 * t + 3] - a[0], p[3 * t + 4] - a[1], p[3 * t + 5] - a[2]];
  const e2 = [p[3 * t + 6] - a[0], p[3 * t + 7] - a[1], p[3 * t + 8] - a[2]];
  const d11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2];
  const d12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
  const d22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
  const det = d11 * d22 - d12 * d12;
  return (x, y, z) => {
    const q = [x - a[0], y - a[1], z - a[2]];
    const q1 = q[0] * e1[0] + q[1] * e1[1] + q[2] * e1[2];
    const q2 = q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2];
    const u = det > 0 ? (d22 * q1 - d12 * q2) / det : 0;
    const w = det > 0 ? (d11 * q2 - d12 * q1) / det : 0;
    return [1 - u - w, u, w];
  };
}

/** Triangle `t`'s per-vertex attribute (`n` a vertex) at weights `w`;
 *  `unit` normalises it, and leaves NaN where a vertex has none. */
function blend(
  a: ArrayLike<number>,
  n: number,
  t: number,
  w: readonly [number, number, number],
  unit: boolean
): number[] {
  const out = Array.from({ length: n }, (_, c) =>
    w.reduce((s, wk, k) => s + wk * a[n * (t + k) + c], 0)
  );
  if (!unit) {
    return out;
  }
  const len = Math.hypot(...out);
  return len > 0 ? out.map((c) => c / len) : out.map(() => Number.NaN);
}
