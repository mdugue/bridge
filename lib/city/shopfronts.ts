/**
 * The shopfronts on the LoD2 walls (pipeline/bake/shopfronts.py: the
 * ground floor's bays and store signs measured in Mapillary's street
 * panoramas, the canopy over them in the surface model) as geometry the
 * building bake appends to the tile's mesh (scripts/bake-city-mesh.ts): per
 * bay a dark glass pane barely proud of the wall, set back in a frame —
 * piers at its edges and between bays, a stall riser under it, a head over
 * it, all standing out of the wall — divided into panels no wider than
 * PANEL_M by slim mullions (a shop window is wide glass in a light frame,
 * not a door), a fascia board where a sign was seen, and the canopy where
 * the surface model shows one: a flat slab out over the pavement with a
 * deep fascia at its edge (the Hauptstraße's GDR pavilions). A glazed row
 * (`row`: glass from pier to pier) sits on a lower riser. No lettering, no
 * column under a canopy (none is measured), no bay where nothing was
 * measured: a wall no photo shows as a shopfront has none (an OSM shop node
 * says a shop is there, not where its windows are).
 *
 * Shop windows on a shop's ground floor are the one exception to the glass
 * veto (docs/transformations.md): the pane is its own object, flagged glass
 * and own colour, with an absolute roughness in its `rough` column.
 * Pure, no THREE.
 */
import { box, type Face, rayHit, type V3 } from "./doors";
import type { DoorFeature, ShopfrontWall } from "./features";
import { type JoinPoint, joinsAlong, SINK } from "./ground-join";

/** How a shopfront stands on its wall (metres): the pane's face out of
 *  the wall, the frame's and the fascia's, how far each reaches back into
 *  it (LoD2's wall is not where the footprint line is, to the centimetre),
 *  a pier's width, the stall riser's top (the pane's sill) above the
 *  ground, the head over the pane, and a fascia's height where its band
 *  was not measured. */
export const SHOPFRONT = {
  back: 0.15,
  fasciaH: 0.5,
  fasciaProud: 0.1,
  frameProud: 0.08,
  head: 0.15,
  paneProud: 0.02,
  pier: 0.25,
  sill: 0.5,
} as const;
/** The pane's top where the ground floor's was not measured. */
export const SHOPFRONT_TOP_M = 3;
/** The pane's top keeps this far under the first storey line. */
export const STOREY_CLEAR_M = 0.2;
/** A pane at least this tall, or the ground floor gets no shop window at all. */
export const MIN_PANE_M = 1.5;
/** A bay narrower than this (after a door is cut out of it) is dropped. */
export const MIN_BAY_M = 1.2;
/** A pane is divided into panels at most this wide (m) by mullions. */
export const PANEL_M = 2;
/** A mullion's width and how far it stands out of the wall (m): slimmer
 *  and flatter than a pier. */
export const MULLION = { proud: 0.05, w: 0.06 } as const;
/** A glazed row's stall riser (m above the ground): the modernist rows
 *  glaze nearly to the pavement. */
export const ROW_SILL_M = 0.3;
/** A canopy (m): its slab's thickness under its measured top, its fascia's
 *  depth and lip over the slab, the tallest fascia, and the headroom the
 *  fascia keeps over the ground. */
export const CANOPY = {
  fasciaD: 0.2,
  fasciaH: 1,
  headroom: 2.6,
  lip: 0.05,
  slab: 0.3,
  tuck: 0.02,
} as const;
/** A shopfront's feet go this far into the ground (each part on its two
 *  ends' lower ground). */
export const SHOPFRONT_SINK = SINK.box;
/** How far from the footprint line a part looks for its wall, either way. */
export const SHOPFRONT_WALL_REACH = 0.6;
/** A door (OSM entrance) keeps this much of the bay clear beside its
 *  surround. */
const DOOR_CLEAR_M = 0.3;
/** How far a fascia reaches down into the head under it (m): the head's
 *  top would otherwise lie in the fascia's bottom face and flicker. */
const FASCIA_TUCK_M = 0.02;
/** How far a pane reaches behind the riser under it and the head over it
 *  (m): edge to edge, the quantised glTF positions open hairline cracks
 *  the lit wall shows through. */
export const PANE_TUCK_M = 0.02;
/** The tallest fascia (m): a sign band measured taller (big lettering, a
 *  banner) is a board this tall at its foot, not a slab over the storey. */
export const FASCIA_MAX_M = 1;

export interface ShopfrontMesh {
  /** the canopies: slab and fascia */
  canopy: number[];
  /** the piers, stall risers, heads, mullions and fascias */
  frame: number[];
  /** the glass */
  pane: number[];
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

/** The mullions dividing a bay into equal panels no wider than PANEL_M. */
export function mullions([s0, s1]: Span): Span[] {
  const n = Math.ceil((s1 - s0) / PANEL_M - 1e-9);
  const out: Span[] = [];
  for (let k = 1; k < n; k++) {
    const c = s0 + ((s1 - s0) * k) / n;
    out.push([c - MULLION.w / 2, c + MULLION.w / 2]);
  }
  return out;
}

/** The stall riser's top above the ground: lower on a glazed row. */
export function sillOf(w: ShopfrontWall): number {
  return w.row ? ROW_SILL_M : SHOPFRONT.sill;
}

/**
 * The piers at the bays' edges: SHOPFRONT.pier wide, or the whole gap
 * where two bays stand closer than two piers.
 */
export function piers(bays: readonly Span[], length: number): Span[] {
  const out: Span[] = [];
  const pier = SHOPFRONT.pier;
  bays.forEach(([s0, s1], i) => {
    const prev = bays[i - 1];
    if (prev && s0 - prev[1] < 2 * pier) {
      out.push([prev[1], s0]); // one pier fills the gap
    } else {
      out.push([Math.max(0, s0 - pier), s0]);
    }
    const next = bays[i + 1];
    if (!(next && next[0] - s1 < 2 * pier)) {
      out.push([s1, Math.min(length, s1 + pier)]);
    }
  });
  return out.filter(([a, b]) => b - a > 0.01);
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

/**
 * A wall's shopfront triangles (mesh frame: x = epsgX − cx, y = epsgY − cy,
 * z up), counter-clockwise from outside, laid `shift(span)` metres out of
 * the footprint line onto the wall (`wallShiftAt`). Empty where no bay is
 * left
 * and no sign was seen, or the ground floor is too low for a pane and no
 * sign was seen (a sign alone is a fascia). Only the faces one can see:
 * no back (in the wall), no bottom (in the ground).
 */
export function shopfrontMesh(
  w: ShopfrontWall,
  bays: readonly Span[],
  storeyH: number,
  offset: { cx: number; cy: number },
  shift: (span: Span) => number = () => 0
): ShopfrontMesh {
  const out: ShopfrontMesh = { canopy: [], frame: [], pane: [] };
  const top = paneTop(w, storeyH);
  const sill = sillOf(w);
  // no window where the ground floor is too low for one: the fascia alone
  const windows = top - sill >= MIN_PANE_M ? bays : [];
  const { back, frameProud, head, paneProud } = SHOPFRONT;
  const all: Face[] = ["+a", "-a", "+b", "+c"];
  const { t, n } = wallFrame(w, offset);
  const mirrored = t[0] * n[1] - t[1] * n[0] < 0;
  const part = (
    to: number[],
    span: Span,
    proud: number,
    z: (foot: number, ground: number) => Span,
    faces: readonly Face[]
  ) => {
    const { at } = wallFrame(w, offset, shift(span));
    const foot = footAt(w, span);
    const ground = Math.max(groundAt(w, span[0]), groundAt(w, span[1]));
    // box winds its faces for a frame whose along × out is up; a wall
    // running the other way round is mirrored by walking it backwards
    const along: Span = mirrored ? [span[1], span[0]] : span;
    box(to, at, along, [-back, proud], z(foot, ground), faces);
  };
  for (const bay of windows) {
    // the pane from the sill to its top, over the bay's higher ground
    part(
      out.pane,
      bay,
      paneProud,
      (_, g) => [g + sill - PANE_TUCK_M, g + top + PANE_TUCK_M],
      ["+b"]
    );
    // the stall riser under it, the head over it
    part(out.frame, bay, frameProud, (f, g) => [f, g + sill], all);
    part(out.frame, bay, frameProud, (_, g) => [g + top, g + top + head], [
      ...all,
      "-c",
    ]);
    // the mullions, on the pane between riser and head (their ends in them)
    for (const m of mullions(bay)) {
      const { at: atBay } = wallFrame(w, offset, shift(bay));
      const g = Math.max(groundAt(w, bay[0]), groundAt(w, bay[1]));
      box(
        out.frame,
        atBay,
        mirrored ? [m[1], m[0]] : m,
        [-back, MULLION.proud],
        [g + sill, g + top],
        ["+a", "-a", "+b"]
      );
    }
  }
  for (const p of piers(windows, w.L)) {
    part(out.frame, p, frameProud, (f, g) => [f, g + top + head], all);
  }
  for (const c of w.canopy ?? []) {
    canopyMesh(w, c, top, (span, proud, z, faces) => {
      const { at } = wallFrame(w, offset, shift(span));
      const along: Span = mirrored ? [span[1], span[0]] : span;
      box(out.canopy, at, along, proud, z, faces);
    });
  }
  for (const [s0, s1] of fasciaSpans(w)) {
    const [z0, z1] = w.sign?.z ?? [top, top + SHOPFRONT.fasciaH];
    part(
      out.frame,
      [s0, s1],
      SHOPFRONT.fasciaProud,
      // a little into the head it sits on, so no two faces lie coplanar
      (_, g) => {
        const bottom = Math.max(z0 - FASCIA_TUCK_M, top);
        return [
          g + bottom,
          g + Math.max(Math.min(z1, bottom + FASCIA_MAX_M), top + head),
        ];
      },
      [...all, "-c"]
    );
  }
  return out;
}

/** Where the fascia boards run: the measured sign spans, clipped to the
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

/**
 * A canopy's slab and fascia, through `put(span, [out0, out1], [z0, z1],
 * faces)`: the slab from the wall out to the fascia, CANOPY.slab thick
 * under the measured top; the fascia at its edge, CANOPY.fasciaD deep,
 * from at most CANOPY.fasciaH under the top (keeping CANOPY.headroom over
 * the ground, and no lower than the pane's head behind it) to a lip over
 * the slab. Heights over the higher ground of the canopy's ends.
 */
export function canopyMesh(
  w: ShopfrontWall,
  c: { at: [number, number]; d: number; h: number },
  top: number,
  put: (
    span: Span,
    out: [number, number],
    z: [number, number],
    faces: readonly Face[]
  ) => void
): void {
  const span: Span = [Math.max(0, c.at[0]), Math.min(w.L, c.at[1])];
  if (span[1] - span[0] < 0.5 || c.d <= CANOPY.fasciaD) {
    return;
  }
  const g = Math.max(groundAt(w, span[0]), groundAt(w, span[1]));
  const slab0 = c.h - CANOPY.slab;
  const fascia0 = Math.max(
    c.h - CANOPY.fasciaH,
    CANOPY.headroom,
    Math.min(top + SHOPFRONT.head, slab0)
  );
  const edge = c.d - CANOPY.fasciaD;
  put(
    span,
    [-CANOPY.tuck, edge + CANOPY.tuck],
    [g + slab0, g + c.h],
    ["+a", "-a", "+c", "-c"]
  );
  put(
    span,
    [edge, c.d],
    [g + Math.min(fascia0, slab0), g + c.h + CANOPY.lip],
    ["+a", "-a", "+b", "+c", "-c"]
  );
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

/** Where a shopfront meets the ground (ADR 0035): the feet of its stall
 *  risers and piers along their faces, EPSG. Where the ground in front is
 *  higher than the lower end's the foot sinks deeper; where it falls away
 *  (a step down off the pavement) the foot is checked here. */
export function shopfrontJoins(
  w: ShopfrontWall,
  bays: readonly Span[]
): JoinPoint[] {
  if (!w.z) {
    return [];
  }
  const out = SHOPFRONT.frameProud;
  const spans = [...bays, ...piers(bays, w.L)].toSorted((p, q) => p[0] - q[0]);
  const tx = (w.b[0] - w.a[0]) / w.L;
  const ty = (w.b[1] - w.a[1]) / w.L;
  const pt = (s: number, z: number) => ({
    x: w.a[0] + tx * s + w.n[0] * out,
    y: w.a[1] + ty * s + w.n[1] * out,
    z,
  });
  return spans.flatMap((span) => {
    const foot = footAt(w, span);
    return joinsAlong("foot", pt(span[0], foot), pt(span[1], foot));
  });
}
