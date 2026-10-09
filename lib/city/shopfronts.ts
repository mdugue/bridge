/**
 * The shopfronts on the LoD2 walls (pipeline/bake/shopfronts.py: the
 * ground floor's bays and store signs measured in Mapillary's street
 * panoramas, the canopy over them in the surface model) as geometry the
 * building bake appends to the tile's mesh (scripts/bake-city-mesh.ts),
 * soft and abstract: per run of bays one surround standing out of the wall
 * — its outer edge rolling over a rounded shoulder, its front flat — with
 * a niche per bay, the front turning into it over a rounded reveal, and
 * the glass at the niche's back, a muted tone a little darker and cooler
 * than the wall (no mullions, no boards, no frame edges). A fascia band
 * where a sign was seen, rounded the same way, and the canopy where the
 * surface model shows one: a slab out over the pavement with a deep
 * fascia at its edge, its edges rounded (the Hauptstraße's GDR pavilions).
 * A glazed row (`row`: glass from pier to pier) sits on a lower riser. No
 * lettering, no column under a canopy (none is measured), no bay where
 * nothing was measured: a wall no photo shows as a shopfront has none (an
 * OSM shop node says a shop is there, not where its windows are).
 *
 * Every face that lies along the wall stands clear of it by more than the
 * building glTF's position quantum (16 bits over the tile, ≈ 3.4 cm on a
 * 2 km tile — `QUANTUM_M`): a pane 2 cm proud of the wall snapped onto it
 * and flickered against it, and 6 cm mullions came out one to three
 * quanta wide from vertex to vertex. No two faces of a shopfront lie on
 * one another (coplanar and overlapping): the parts meet by reaching into
 * each other's volume, never face to face.
 *
 * Shop windows on a shop's ground floor are the one exception to the glass
 * veto (docs/transformations.md): the pane is its own object, flagged glass
 * and own colour, with an absolute roughness in its `rough` column.
 * Pure, no THREE.
 */
import { rayHit, type V3 } from "./doors";
import type { DoorFeature, ShopfrontWall } from "./features";
import { type JoinPoint, joinsAlong, SINK } from "./ground-join";

/** The building glTF's position step (m): 16-bit positions over a 2 km
 *  tile's buildings (scripts/tile-glb.ts). Anything along the wall stands
 *  at least about two of these off it. */
export const QUANTUM_M = 0.034;

/** How a shopfront stands on its wall (metres): how far the surround
 *  reaches back into the wall (LoD2's wall is not where the footprint
 *  line is, to the centimetre) and stands out of it, the glass's face out
 *  of the wall (the niche's back, well clear of the wall's face), how far
 *  the reveal runs on behind the glass, the rounds of the reveal and of
 *  the outer shoulder, a pier's width (and the narrowest one between two
 *  bays), the stall riser's top (the pane's sill) above the ground, the
 *  head over the pane, and a fascia's height where its band was not
 *  measured, how far it stands out and its round. */
export const SHOPFRONT = {
  back: 0.15,
  fasciaH: 0.5,
  fasciaProud: 0.1,
  fasciaRound: 0.045,
  glass: 0.06,
  head: 0.18,
  minPier: 0.2,
  pier: 0.25,
  proud: 0.15,
  reveal: 0.07,
  shoulder: 0.06,
  sill: 0.5,
  tuck: 0.03,
} as const;
/** Facets per quarter round: two, each about one and a half of the
 *  glTF's position quanta long — finer facets came out of the quantising
 *  ragged and sparkled along an edge seen at a distance; the per-vertex
 *  normals shade them round. */
const ROUND_STEPS = 2;
/** The pane's top where the ground floor's was not measured. */
export const SHOPFRONT_TOP_M = 3;
/** The pane's top keeps this far under the first storey line. */
export const STOREY_CLEAR_M = 0.2;
/** A pane at least this tall, or the ground floor gets no shop window at all. */
export const MIN_PANE_M = 1.5;
/** A bay narrower than this (after a door is cut out of it) is dropped. */
export const MIN_BAY_M = 1.2;
/** Two runs of bays with less wall than this between their surrounds are
 *  one surround (two surrounds side by side would meet face to face). */
export const MIN_WALL_M = 0.4;
/** A glazed row's stall riser (m above the ground): the modernist rows
 *  glaze nearly to the pavement. */
export const ROW_SILL_M = 0.3;
/** A canopy (m): its slab's thickness under its measured top, its fascia's
 *  depth, the tallest fascia, the headroom the fascia keeps over the
 *  ground, the round of its outer edges, how far a surround's head
 *  reaches up into the slab over it, and the most wall left between the
 *  head and the slab for the head to reach up (a taller gap stays wall). */
export const CANOPY = {
  fasciaD: 0.2,
  fasciaH: 1,
  headroom: 2.6,
  round: 0.09,
  reach: 0.25,
  slab: 0.3,
  tuck: 0.08,
} as const;
/** A shopfront's feet go this far into the ground (each surround on its
 *  ends' lower ground). */
export const SHOPFRONT_SINK = SINK.box;
/** How far from the footprint line a part looks for its wall, either way. */
export const SHOPFRONT_WALL_REACH = 0.6;
/** A door (OSM entrance) keeps this much of the bay clear beside its
 *  surround. */
const DOOR_CLEAR_M = 0.3;
/** How far a fascia reaches down into the surround's head under it (m). */
const FASCIA_INTO_M = 0.08;
/** The tallest fascia (m): a sign band measured taller (big lettering, a
 *  banner) is a band this tall at its foot, not a slab over the storey. */
export const FASCIA_MAX_M = 1;

/** Triangles with a normal per vertex (unit; smooth over a round). */
export interface Shaded {
  normals: number[];
  positions: number[];
}

/** One run's glass: its triangles and the pane's top (absolute). */
export interface Pane {
  positions: number[];
  top: number;
}

export interface ShopfrontMesh {
  /** the canopies: slab and fascia, rounded */
  canopy: Shaded;
  /** the surrounds and the fascia bands */
  frame: Shaded;
  /** the glass, one per run of bays */
  panes: Pane[];
}

/** A run along the wall, metres from `a`. */
export type Span = [number, number];

/** The wall's frame in the mesh: along it from `a`, out of it, absolute
 *  height (right-handed: t × n points down, so faces are wound by `box`). */
export function wallFrame(
  w: ShopfrontWall,
  offset: { cx: number; cy: number },
  shift = 0
): { at: (s: number, out: number, z: number) => V3; n: V3; t: V3 } {
  const t: V3 = [(w.b[0] - w.a[0]) / w.L, (w.b[1] - w.a[1]) / w.L, 0];
  const n: V3 = [w.n[0], w.n[1], 0];
  const ox = w.a[0] - offset.cx + n[0] * shift;
  const oy = w.a[1] - offset.cy + n[1] * shift;
  return {
    n,
    t,
    at: (s, out, z) => [
      ox + t[0] * s + n[0] * out,
      oy + t[1] * s + n[1] * out,
      z,
    ],
  };
}

/** The ground in front of the wall at `s` (linear between its ends). */
export function groundAt(w: ShopfrontWall, s: number): number {
  const [za, zb] = w.z ?? [0, 0];
  const f = Math.min(Math.max(s / w.L, 0), 1);
  return za + (zb - za) * f;
}

/** A part's foot over [s0, s1]: the lower ground of its ends, sunk. */
export function footAt(w: ShopfrontWall, [s0, s1]: Span): number {
  return Math.min(groundAt(w, s0), groundAt(w, s1)) - SHOPFRONT_SINK;
}

/** `spans` with `cut` taken out of them. */
function without(spans: readonly Span[], cut: Span): Span[] {
  return spans.flatMap(([s0, s1]): Span[] => {
    if (cut[1] <= s0 || cut[0] >= s1) {
      return [[s0, s1]];
    }
    return [
      [s0, Math.min(s1, cut[0])],
      [Math.max(s0, cut[1]), s1],
    ].filter(([a, b]) => b - a > 0) as Span[];
  });
}

/** The doors on this wall (the same building, within reach of its line),
 *  as the spans their surrounds and a clearance take. */
export function doorSpans(
  w: ShopfrontWall,
  doors: readonly DoorFeature[],
  sameBuilding: (of: string) => boolean
): Span[] {
  const out: Span[] = [];
  const tx = (w.b[0] - w.a[0]) / w.L;
  const ty = (w.b[1] - w.a[1]) / w.L;
  for (const f of doors) {
    const p = f.properties;
    if (!(p && sameBuilding(p.of))) {
      continue;
    }
    const [x, y] = f.geometry.coordinates;
    const s = (x - w.a[0]) * tx + (y - w.a[1]) * ty;
    const off = (x - w.a[0]) * w.n[0] + (y - w.a[1]) * w.n[1];
    const half = p.w / 2 + 0.14 + DOOR_CLEAR_M;
    if (
      Math.abs(off) <= SHOPFRONT_WALL_REACH &&
      s + half > 0 &&
      s - half < w.L
    ) {
      out.push([s - half, s + half]);
    }
  }
  return out;
}

/**
 * The wall's bays as drawn: the measured ones clipped to the wall inside
 * its end piers, with the doors cut out; a piece narrower than MIN_BAY_M
 * dropped.
 */
export function wallBays(w: ShopfrontWall, doors: readonly Span[]): Span[] {
  const inset = SHOPFRONT.pier;
  let bays = (w.bays ?? []).map(([s0, s1]): Span => [
    Math.max(s0, inset),
    Math.min(s1, w.L - inset),
  ]);
  for (const d of doors) {
    bays = without(bays, d);
  }
  return bays.filter(([s0, s1]) => s1 - s0 >= MIN_BAY_M - 1e-9);
}

/** The stall riser's top above the ground: lower on a glazed row. */
export function sillOf(w: ShopfrontWall): number {
  return w.row ? ROW_SILL_M : SHOPFRONT.sill;
}

/** A run of bays under one surround: its bays (left to right) and its
 *  span along the wall, the end piers included. */
export interface BayRun {
  bays: Span[];
  span: Span;
}

/**
 * The bays in runs, each under one surround: a bay with less than two
 * piers and MIN_WALL_M of wall to the one before it shares its surround,
 * the pier between them at least SHOPFRONT.minPier wide (two bays closer
 * than that drawn back from the gap's middle); a run's end piers
 * SHOPFRONT.pier wide, inside the wall.
 */
export function bayRuns(bays: readonly Span[], length: number): BayRun[] {
  const { minPier, pier } = SHOPFRONT;
  const runs: BayRun[] = [];
  for (const [s0, s1] of bays.toSorted((p, q) => p[0] - q[0])) {
    const run = runs.at(-1);
    const prev = run?.bays.at(-1);
    if (!(run && prev && s0 - prev[1] < 2 * pier + MIN_WALL_M)) {
      runs.push({ bays: [[s0, s1]], span: [0, 0] });
      continue;
    }
    if (s0 - prev[1] < minPier) {
      const mid = (prev[1] + s0) / 2;
      prev[1] = mid - minPier / 2;
      run.bays.push([mid + minPier / 2, s1]);
    } else {
      run.bays.push([s0, s1]);
    }
  }
  for (const run of runs) {
    const first = run.bays[0];
    const last = run.bays.at(-1) ?? first;
    run.span = [Math.max(0, first[0] - pier), Math.min(length, last[1] + pier)];
  }
  return runs;
}

/** The pane's top above the ground: the measured ground floor's (or
 *  SHOPFRONT_TOP_M), under the first storey line, under a measured sign. */
export function paneTop(w: ShopfrontWall, storeyH: number): number {
  let top = Math.min(w.gf_top ?? SHOPFRONT_TOP_M, storeyH - STOREY_CLEAR_M);
  // a sign hangs over the window: the pane ends under it, unless the sign
  // was measured too low for a window under it (then the fascia goes up)
  const under = (w.sign?.z?.[0] ?? Number.POSITIVE_INFINITY) - SHOPFRONT.head;
  if (under - sillOf(w) >= MIN_PANE_M) {
    top = Math.min(top, under);
  }
  // under a canopy, the pane and its head end under the slab
  for (const c of w.canopy ?? []) {
    top = Math.min(top, c.h - CANOPY.slab - SHOPFRONT.head);
  }
  return top;
}

/** A rectangle on the wall: along it (m from `a`) and up (absolute). */
interface Rect {
  s0: number;
  s1: number;
  z0: number;
  z1: number;
}

type Frame = ReturnType<typeof wallFrame>;

/** A point of a soft edge's cross-section: `e` out from the rectangle's
 *  edge (in the wall's plane; negative inside it), `o` out of the wall,
 *  and its normal's components along the edge's outward direction (`nu`)
 *  and out of the wall (`no`). */
interface EdgePoint {
  e: number;
  no: number;
  nu: number;
  o: number;
}

/** The outer shoulder of a band standing `proud` out of the wall: up out
 *  of the wall (from `back` inside it), then a quarter round of radius `r`
 *  into the front. */
function shoulder(back: number, proud: number, r: number): EdgePoint[] {
  const out: EdgePoint[] = [{ e: 0, o: -back, nu: 1, no: 0 }];
  for (let k = 0; k <= ROUND_STEPS; k++) {
    const a = ((Math.PI / 2) * k) / ROUND_STEPS;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push({ e: -r + r * c, o: proud - r + r * s, nu: c, no: s });
  }
  return out;
}

/** A niche's reveal: from `inner` (behind the glass) out of the wall to a
 *  quarter round of radius `r` that turns it into the front at `proud`. */
function reveal(inner: number, proud: number, r: number): EdgePoint[] {
  const out: EdgePoint[] = [{ e: 0, o: inner, nu: -1, no: 0 }];
  for (let k = 0; k <= ROUND_STEPS; k++) {
    const a = ((Math.PI / 2) * k) / ROUND_STEPS;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push({ e: r - r * c, o: proud - r + r * s, nu: -c, no: s });
  }
  return out;
}

/** The unit direction `ds` along the wall, `dout` out of it, `dz` up. */
function dir3(f: Frame, ds: number, dout: number, dz: number): V3 {
  const v: V3 = [f.t[0] * ds + f.n[0] * dout, f.t[1] * ds + f.n[1] * dout, dz];
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Twice the area vector of a polygon (Newell): its normal for the order
 *  given. */
function newell(p: readonly V3[]): V3 {
  const n: V3 = [0, 0, 0];
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  return n;
}

/** A convex polygon as a fan of triangles wound to face `facing` (its
 *  vertices' normals `normals`); nothing where it has no area. */
function polygon(
  out: Shaded,
  p: readonly V3[],
  normals: readonly V3[],
  facing: V3
): void {
  // a round's ends meet the flat stretch beside it: no repeated points
  const keep = p
    .map((_, i) => i)
    .filter((i) => {
      const q = p[(i + 1) % p.length];
      return Math.hypot(p[i][0] - q[0], p[i][1] - q[1], p[i][2] - q[2]) > 1e-9;
    });
  const n = newell(keep.map((i) => p[i]));
  if (keep.length < 3 || Math.hypot(...n) < 1e-9) {
    return;
  }
  const flip = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0;
  for (let i = 1; i + 1 < keep.length; i++) {
    const tri = flip ? [0, i + 1, i] : [0, i, i + 1];
    for (const j of tri) {
      out.positions.push(...p[keep[j]]);
      out.normals.push(...normals[keep[j]]);
    }
  }
}

/** The values of `xs` strictly between lo and hi. */
const between = (xs: readonly number[], lo: number, hi: number) =>
  xs.filter((x) => x > lo + 1e-6 && x < hi - 1e-6);

/**
 * A soft edge round `r` (a band's shoulder, a niche's reveal): the
 * cross-section `profile` swept round the rectangle, the corners mitred
 * (each section point on the rectangle offset by its `e`), each side cut
 * at the breaks the front's grid has on it (`sBreaks` along, `zBreaks`
 * up), so no vertex of the front lies on a side's edge (a T-junction
 * cracks open once the glTF quantises them). `open`: no bottom side, the
 * rectangle's foot in the ground, not offset.
 */
function softEdge(
  out: Shaded,
  f: Frame,
  r: Rect,
  profile: readonly EdgePoint[],
  breaks: { s: readonly number[]; z: readonly number[] },
  open = false
): void {
  const eMin = Math.min(...profile.map((p) => p.e));
  const rect = (e: number): Rect => ({
    s0: r.s0 - e,
    s1: r.s1 + e,
    z0: open ? r.z0 : r.z0 - e,
    z1: r.z1 + e,
  });
  const sIn = between(breaks.s, r.s0 - eMin, r.s1 + eMin);
  const zIn = between(breaks.z, open ? r.z0 : r.z0 - eMin, r.z1 + eMin);
  // each side: its points on a loop (along, up), its outward direction
  type Side = [(q: Rect) => [number, number][], number, number];
  const sides: Side[] = [
    [(q) => [q.s0, ...sIn, q.s1].map((s) => [s, q.z1]), 0, 1],
    [(q) => [q.z1, ...zIn.toReversed(), q.z0].map((z) => [q.s1, z]), 1, 0],
    [(q) => [q.z0, ...zIn, q.z1].map((z) => [q.s0, z]), -1, 0],
  ];
  if (!open) {
    sides.push([
      (q) => [q.s1, ...sIn.toReversed(), q.s0].map((s) => [s, q.z0]),
      0,
      -1,
    ]);
  }
  for (const [points, us, uz] of sides) {
    for (let k = 0; k + 1 < profile.length; k++) {
      const [p, q] = [profile[k], profile[k + 1]];
      const lp = points(rect(p.e));
      const lq = points(rect(q.e));
      const np = dir3(f, p.nu * us, p.no, p.nu * uz);
      const nq = dir3(f, q.nu * us, q.no, q.nu * uz);
      const facing = dir3(
        f,
        (p.nu + q.nu) * us,
        p.no + q.no,
        (p.nu + q.nu) * uz
      );
      for (let j = 0; j + 1 < lp.length; j++) {
        polygon(
          out,
          [
            f.at(lp[j][0], p.o, lp[j][1]),
            f.at(lp[j + 1][0], p.o, lp[j + 1][1]),
            f.at(lq[j + 1][0], q.o, lq[j + 1][1]),
            f.at(lq[j][0], q.o, lq[j][1]),
          ],
          [np, np, nq, nq],
          facing
        );
      }
    }
  }
}

/**
 * A band standing `proud` out of the wall over `outer`, its outer edge
 * rolling over a quarter round of `round` into its flat front, with a
 * niche at each of `holes`: the front turning into it over a quarter round
 * of SHOPFRONT.reveal, its reveal running back to `inner` (behind the
 * glass). The front is cut on one grid, every cell edge to edge with its
 * neighbours and the rounds. `open`: its foot in the ground (no bottom).
 */
function softBand(
  out: Shaded,
  f: Frame,
  outer: Rect,
  holes: readonly Rect[],
  band: { inner: number; open: boolean; proud: number; round: number }
): void {
  const { open, proud, round } = band;
  const ri = SHOPFRONT.reveal;
  const face: Rect = {
    s0: outer.s0 + round,
    s1: outer.s1 - round,
    z0: open ? outer.z0 : outer.z0 + round,
    z1: outer.z1 - round,
  };
  const cut = holes.map((h) => ({
    s0: h.s0 - ri,
    s1: h.s1 + ri,
    z0: h.z0 - ri,
    z1: h.z1 + ri,
  }));
  const grid = (lo: number, hi: number, xs: number[]) =>
    [...new Set([lo, hi, ...xs.filter((x) => x > lo && x < hi)])].toSorted(
      (a, b) => a - b
    );
  const s = grid(
    face.s0,
    face.s1,
    cut.flatMap((h) => [h.s0, h.s1])
  );
  const z = grid(
    face.z0,
    face.z1,
    cut.flatMap((h) => [h.z0, h.z1])
  );
  const n = dir3(f, 0, 1, 0);
  for (let i = 0; i + 1 < s.length; i++) {
    for (let j = 0; j + 1 < z.length; j++) {
      const sc = (s[i] + s[i + 1]) / 2;
      const zc = (z[j] + z[j + 1]) / 2;
      if (cut.some((h) => sc > h.s0 && sc < h.s1 && zc > h.z0 && zc < h.z1)) {
        continue;
      }
      polygon(
        out,
        [
          f.at(s[i], proud, z[j]),
          f.at(s[i + 1], proud, z[j]),
          f.at(s[i + 1], proud, z[j + 1]),
          f.at(s[i], proud, z[j + 1]),
        ],
        [n, n, n, n],
        n
      );
    }
  }
  const breaks = { s, z };
  softEdge(out, f, outer, shoulder(SHOPFRONT.back, proud, round), breaks, open);
  for (const h of holes) {
    softEdge(out, f, h, reveal(band.inner, proud, ri), breaks);
  }
}

/**
 * A wall's shopfront triangles (mesh frame: x = epsgX − cx, y = epsgY − cy,
 * z up), counter-clockwise from outside, laid `shift(span)` metres out of
 * the footprint line onto the wall (`wallShiftAt`): per run of bays a
 * surround (`bayRuns`) with its niches and their glass, the fascia bands,
 * the canopies. Empty where no bay is left and no sign was seen, or the
 * ground floor is too low for a pane and no sign was seen (a sign alone
 * is a fascia). Only the faces one can see: no back (in the wall), no
 * bottom (in the ground).
 */
export function shopfrontMesh(
  w: ShopfrontWall,
  bays: readonly Span[],
  storeyH: number,
  offset: { cx: number; cy: number },
  shift: (span: Span) => number = () => 0
): ShopfrontMesh {
  const out: ShopfrontMesh = {
    canopy: { normals: [], positions: [] },
    frame: { normals: [], positions: [] },
    panes: [],
  };
  const top = paneTop(w, storeyH);
  const sill = sillOf(w);
  // no window where the ground floor is too low for one: the fascia alone
  const windows = top - sill >= MIN_PANE_M ? bays : [];
  const { glass, head, proud, shoulder: round, tuck } = SHOPFRONT;
  const runs = bayRuns(windows, w.L).map((run) => ({
    ...run,
    span: clearOf(run.span, canopyEnds(w), -1),
  }));
  for (const run of runs) {
    const f = wallFrame(w, offset, shift(run.span));
    const g = Math.max(groundAt(w, run.span[0]), groundAt(w, run.span[1]));
    // under a canopy the head ends under its slab — or, where only a
    // strip of wall would be left between them, reaches up into it
    const slab = canopySlabOver(w, run.span);
    const paneZ = Math.min(g + top, (slab ?? Number.POSITIVE_INFINITY) - head);
    const reach =
      slab !== undefined && slab - (paneZ + head) < CANOPY.reach
        ? slab + CANOPY.tuck
        : paneZ + head;
    if (paneZ - (g + sill) < MIN_PANE_M / 2) {
      continue;
    }
    const holes = run.bays.map(([s0, s1]) => ({
      s0,
      s1,
      z0: g + sill,
      z1: paneZ,
    }));
    softBand(
      out.frame,
      f,
      {
        s0: run.span[0],
        s1: run.span[1],
        z0: footAt(w, run.span),
        z1: reach,
      },
      holes,
      { inner: glass - tuck, open: true, proud, round }
    );
    const pane: Pane = { positions: [], top: paneZ };
    const n = dir3(f, 0, 1, 0);
    for (const h of holes) {
      const flat: Shaded = { normals: [], positions: pane.positions };
      polygon(
        flat,
        [
          f.at(h.s0, glass, h.z0),
          f.at(h.s1, glass, h.z0),
          f.at(h.s1, glass, h.z1),
          f.at(h.s0, glass, h.z1),
        ],
        [n, n, n, n],
        n
      );
    }
    out.panes.push(pane);
  }
  for (const c of w.canopy ?? []) {
    const span: Span = [Math.max(0, c.at[0]), Math.min(w.L, c.at[1])];
    canopyMesh(out.canopy, w, c, top, wallFrame(w, offset, shift(span)));
  }
  const runEnds = runs.flatMap((r) => r.span);
  for (const span of fasciaSpans(w).map((sp) => clearOf(sp, runEnds, 1))) {
    const g = Math.max(groundAt(w, span[0]), groundAt(w, span[1]));
    const [z0, z1] = w.sign?.z ?? [top, top + SHOPFRONT.fasciaH];
    // over a window it reaches down into the surround's head
    const bottom =
      windows.length > 0 ? Math.max(z0, top + head) - FASCIA_INTO_M : z0;
    const height = Math.max(Math.min(z1 - bottom, FASCIA_MAX_M), 0.3);
    softBand(
      out.frame,
      wallFrame(w, offset, shift(span)),
      { s0: span[0], s1: span[1], z0: g + bottom, z1: g + bottom + height },
      [],
      {
        inner: 0,
        open: false,
        proud: SHOPFRONT.fasciaProud,
        round: SHOPFRONT.fasciaRound,
      }
    );
  }
  return out;
}

/** How far a part's end keeps from another's end it would meet face to
 *  face (m): their end faces would lie on one another. */
const END_CLEAR_M = 0.06;

/** `span` with each end that lies within END_CLEAR_M of one of `ends`
 *  moved END_CLEAR_M off it: inwards (`dir` −1) or outwards (1). */
function clearOf([s0, s1]: Span, ends: readonly number[], dir: 1 | -1): Span {
  const near = (s: number) => ends.some((e) => Math.abs(e - s) < END_CLEAR_M);
  return [
    near(s0) ? s0 - dir * END_CLEAR_M : s0,
    near(s1) ? s1 + dir * END_CLEAR_M : s1,
  ];
}

/** Where the canopies on a wall end (m along it). */
function canopyEnds(w: ShopfrontWall): number[] {
  return (w.canopy ?? []).flatMap((c) => [
    Math.max(0, c.at[0]),
    Math.min(w.L, c.at[1]),
  ]);
}

/** The underside of the lowest canopy slab over any of `span` (absolute),
 *  or undefined where none is. */
function canopySlabOver(w: ShopfrontWall, [s0, s1]: Span): number | undefined {
  let low: number | undefined;
  for (const c of w.canopy ?? []) {
    if (c.at[1] <= s0 || c.at[0] >= s1) {
      continue;
    }
    const span: Span = [Math.max(0, c.at[0]), Math.min(w.L, c.at[1])];
    const g = Math.max(groundAt(w, span[0]), groundAt(w, span[1]));
    const z = g + c.h - CANOPY.slab;
    low = Math.min(low ?? z, z);
  }
  return low;
}

/** Where the fascia bands run: the measured sign spans, clipped to the
 *  wall; none without a sign, none under a canopy (its fascia is the sign
 *  band). */
export function fasciaSpans(w: ShopfrontWall): Span[] {
  if ((w.canopy ?? []).length > 0) {
    return [];
  }
  return (w.sign?.at ?? [])
    .map(([s0, s1]): Span => [Math.max(0, s0), Math.min(w.L, s1)])
    .filter(([s0, s1]) => s1 - s0 >= 0.5);
}

/** A point of a canopy's cross-section (out of the wall, up) with its
 *  normal (out, up). */
type Section = [o: number, z: number, no: number, nz: number];

/** A quarter round about (co, cz) from angle a0 to a1 (degrees). */
function arc(co: number, cz: number, r: number, a0: number, a1: number) {
  const out: Section[] = [];
  for (let k = 0; k <= ROUND_STEPS; k++) {
    const a = ((a0 + ((a1 - a0) * k) / ROUND_STEPS) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([co + r * c, cz + r * s, c, s]);
  }
  return out;
}

/**
 * A canopy's cross-section (heights over its ground): the slab from the
 * wall out to the fascia, CANOPY.slab thick under the measured top; the
 * fascia at its edge, CANOPY.fasciaD deep, from at most CANOPY.fasciaH
 * under the top (keeping CANOPY.headroom over the ground, and no lower
 * than the pane's head behind it) to the top — its outer edges rounded,
 * its inner foot too. As runs of points, each run smooth (a flat stretch
 * and the rounds it turns into), a crease between runs; and the convex
 * pieces that cap its ends.
 */
export function canopySection(
  c: { d: number; h: number },
  top: number
): { caps: [number, number][][]; runs: Section[][] } {
  const { back } = SHOPFRONT;
  const r = CANOPY.round;
  const slab0 = c.h - CANOPY.slab;
  const fascia0 = Math.max(
    c.h - CANOPY.fasciaH,
    CANOPY.headroom,
    Math.min(top + SHOPFRONT.head, slab0)
  );
  const edge = c.d - CANOPY.fasciaD;
  const ri = CANOPY.fasciaD - r;
  const front = [
    ...arc(c.d - r, fascia0 + r, r, 270, 360),
    ...arc(c.d - r, c.h - r, r, 0, 90),
    [-back, c.h, 0, 1] as Section,
  ];
  const outline = (s: Section[]) => s.map(([o, z]): [number, number] => [o, z]);
  if (slab0 - fascia0 <= ri + 0.02) {
    // no fascia under the slab: the slab's edge is the fascia
    const runs = [
      [
        [-back, slab0, 0, -1] as Section,
        ...arc(c.d - r, slab0 + r, r, 270, 360),
      ],
      arc(c.d - r, c.h - r, r, 0, 90).concat([[-back, c.h, 0, 1]]),
    ];
    return { runs, caps: [outline(runs.flat())] };
  }
  const fascia = [
    [edge, slab0, -1, 0] as Section,
    ...arc(edge + ri, fascia0 + ri, ri, 180, 270),
    ...front,
  ];
  return {
    runs: [
      [
        [-back, slab0, 0, -1],
        [edge, slab0, 0, -1],
      ],
      fascia,
    ],
    caps: [
      [
        [-back, slab0],
        [edge, slab0],
        [edge, c.h],
        [-back, c.h],
      ],
      outline(fascia.slice(0, -1)).concat([[edge, c.h]]),
    ],
  };
}

/** A canopy's slab and fascia (`canopySection`) along its span on the
 *  wall, capped at both ends, onto `out`. */
export function canopyMesh(
  out: Shaded,
  w: ShopfrontWall,
  c: { at: [number, number]; d: number; h: number },
  top: number,
  f: Frame
): void {
  const span: Span = [Math.max(0, c.at[0]), Math.min(w.L, c.at[1])];
  if (span[1] - span[0] < 0.5 || c.d <= CANOPY.fasciaD) {
    return;
  }
  const g = Math.max(groundAt(w, span[0]), groundAt(w, span[1]));
  const { caps, runs } = canopySection(c, top);
  for (const run of runs) {
    for (let k = 0; k + 1 < run.length; k++) {
      const [p, q] = [run[k], run[k + 1]];
      const np = dir3(f, 0, p[2], p[3]);
      const nq = dir3(f, 0, q[2], q[3]);
      polygon(
        out,
        [
          f.at(span[0], p[0], g + p[1]),
          f.at(span[1], p[0], g + p[1]),
          f.at(span[1], q[0], g + q[1]),
          f.at(span[0], q[0], g + q[1]),
        ],
        [np, np, nq, nq],
        dir3(f, 0, p[2] + q[2], p[3] + q[3])
      );
    }
  }
  for (const [s, side] of [
    [span[0], -1],
    [span[1], 1],
  ] as const) {
    const n = dir3(f, side, 0, 0);
    for (const cap of caps) {
      polygon(
        out,
        cap.map(([o, z]) => f.at(s, o, g + z)),
        cap.map(() => n),
        n
      );
    }
  }
}

/**
 * How far the host's wall stands out of the footprint line over `span`
 * (metres along the wall's outward normal; negative where it stands back):
 * rays at its ends and middle at knee and head height against the host's
 * triangles, the outermost hit; 0 where none meets the wall within
 * SHOPFRONT_WALL_REACH.
 */
export function wallShiftAt(
  w: ShopfrontWall,
  span: Span,
  offset: { cx: number; cy: number },
  positions: ArrayLike<number>,
  triangles: readonly number[]
): number {
  const { at, n } = wallFrame(w, offset);
  let shift = Number.NEGATIVE_INFINITY;
  for (const s of [span[0] + 0.05, (span[0] + span[1]) / 2, span[1] - 0.05]) {
    for (const c of [1, 2.5]) {
      const o = at(s, SHOPFRONT_WALL_REACH, groundAt(w, s) + c);
      for (const t of triangles) {
        const hit = rayHit(o, n, positions, t);
        if (hit !== undefined && hit <= 2 * SHOPFRONT_WALL_REACH) {
          shift = Math.max(shift, SHOPFRONT_WALL_REACH - hit);
        }
      }
    }
  }
  return Number.isFinite(shift) ? shift : 0;
}

/** Where a shopfront meets the ground (ADR 0035): the feet of its
 *  surrounds along their fronts, EPSG. Where the ground in front is higher
 *  than the lower end's the foot sinks deeper; where it falls away (a step
 *  down off the pavement) the foot is checked here. */
export function shopfrontJoins(
  w: ShopfrontWall,
  bays: readonly Span[]
): JoinPoint[] {
  if (!w.z) {
    return [];
  }
  const out = SHOPFRONT.proud;
  const tx = (w.b[0] - w.a[0]) / w.L;
  const ty = (w.b[1] - w.a[1]) / w.L;
  const pt = (s: number, z: number) => ({
    x: w.a[0] + tx * s + w.n[0] * out,
    y: w.a[1] + ty * s + w.n[1] * out,
    z,
  });
  return bayRuns(bays, w.L).flatMap(({ span }) => {
    const foot = footAt(w, span);
    return joinsAlong("foot", pt(span[0], foot), pt(span[1], foot));
  });
}
