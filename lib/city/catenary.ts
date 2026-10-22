/**
 * The main line's overhead contact line, drawn by
 * app/_components/catenary-layer.ts over the tracks the rail layer draws:
 * where its supports stand, which tracks share one, how the wires hang
 * between them. DOM-free, THREE-free, pure.
 *
 * A German main line's catenary (Re 200 and its kin): a contact wire 5.5 m
 * over the rail head, level, zig-zagging ±0.3 m across the track from
 * support to support; a messenger 1.4 m above it at each support, sagging
 * between them, droppers from it down to the contact wire; a mast beside
 * the track every 50–70 m with a cantilever over it — or, where three
 * tracks and more run side by side, a portal across them all. Only a
 * track with a contact line (`electrified` 1) gets one: Hamburg's S- and
 * U-Bahn take their current from a third rail.
 *
 * Supports stand where a track crosses a line of a site-wide grid, every
 * SUPPORT_GRID_M of x or of z — of the axis the track runs along more.
 * The grid is the same for each tile's piece of a track (a seam does not
 * move a mast) and for the tracks side by side, whose supports so line up
 * into one cross-section (`crossSections`). Where OSM maps a catenary mast
 * (`power=catenary_mast`, pipeline/bake/rail_osm.py `masts`), it stands
 * instead of the grid's supports near it.
 */

/** The contact wire above the rail head (m). */
export const CONTACT_WIRE_M = 5.5;
/** The messenger above the contact wire at a support (m): the system
 *  height. */
export const SYSTEM_HEIGHT_M = 1.4;
/** The messenger's sag at mid-span on a span of SUPPORT_GRID_M (m); a
 *  longer span sags more, to MAX_SAG_M. */
export const MESSENGER_SAG_M = 0.9;
/** The most the messenger sags (m): a dropper of 0.4 m at mid-span. */
export const MAX_SAG_M = 1.0;
/** The supports' grid (m). A track along an axis gets one every 50 m, a
 *  diagonal one every 71. */
export const SUPPORT_GRID_M = 50;
/** No two supports of a track closer than this (m): where a curve turns
 *  from one axis's grid to the other's. */
export const MIN_SPAN_M = 25;
/** A grid support this close to a mapped mast (m) gives way to it. */
export const MAPPED_REACH_M = 30;
/** The contact wire's zig-zag across the track at a support (m). */
export const STAGGER_M = 0.3;
/** A mast's distance from the track it holds (m). */
export const MAST_OFFSET_M = 3.2;
/** A mast's head above the messenger's support (m). */
export const MAST_HEAD_M = 0.6;
/** A portal's beam above the highest messenger it holds (m). */
export const PORTAL_CLEAR_M = 0.6;
/** Supports on one grid line this close along it (m) are one
 *  cross-section, when their tracks run side by side… */
export const GROUP_GAP_M = 7;
/** …parallel (the cosine between their directions)… */
export const PARALLEL_COS = 0.94;
/** …and on one level (m): not a track on a viaduct over another. */
export const GROUP_LEVEL_M = 3;
/** A cross-section of this many tracks or more is spanned by a portal. */
export const PORTAL_TRACKS = 3;
/** A deck this far over the rail head (m) is a bridge over the track… */
export const OVERPASS_M = 3;
/** …its soffit this far under its top (m: a deck's usual depth)… */
export const OVERPASS_DEPTH_M = 1.2;
/** …and no support stands under it or this close to it (m). */
export const OVERPASS_CLEAR_M = 10;
/** Under a bridge the messenger runs this far under the soffit (m), the
 *  contact wire at least MIN_SYSTEM_M under the messenger, never lower
 *  than CONTACT_MIN_M over the rail head (the DB's least at a bridge). */
const SOFFIT_CLEAR_M = 0.15;
const MIN_SYSTEM_M = 0.3;
export const CONTACT_MIN_M = 4.95;

type XZ = { x: number; z: number };

/** One support of a track: its station (m along the track) and the grid
 *  line it stands on (`x:12` = x 600 m), null for a mapped mast. */
export interface Support {
  d: number;
  key: string | null;
}

/** The grid lines a segment a → b crosses, in (lo, hi] of the axis it runs
 *  along more: [key, t along the segment]. */
function gridCrossings(a: XZ, b: XZ): [string, number][] {
  const alongX = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
  const va = alongX ? a.x : a.z;
  const vb = alongX ? b.x : b.z;
  if (va === vb) {
    return [];
  }
  const lo = Math.min(va, vb);
  const hi = Math.max(va, vb);
  const out: [string, number][] = [];
  for (
    let k = Math.floor(lo / SUPPORT_GRID_M) + 1;
    k * SUPPORT_GRID_M <= hi;
    k++
  ) {
    out.push([
      `${alongX ? "x" : "z"}:${k}`,
      (k * SUPPORT_GRID_M - va) / (vb - va),
    ]);
  }
  if (vb < va) {
    out.reverse();
  }
  return out;
}

/**
 * A track's supports, by station: the mapped masts (`mapped`, stations
 * along it) and the grid's (`SUPPORT_GRID_M`) where none stands within
 * MAPPED_REACH_M, no two closer than MIN_SPAN_M (a mapped mast wins). `pts`
 * are the track's points in the world frame, `d` their stations.
 */
export function supportStations(
  pts: readonly XZ[],
  d: readonly number[],
  mapped: readonly number[] = []
): Support[] {
  const near = (s: number) =>
    mapped.some((m) => Math.abs(m - s) <= MAPPED_REACH_M);
  const all: Support[] = mapped.map((m) => ({ d: m, key: null }));
  for (let i = 1; i < pts.length; i++) {
    for (const [key, t] of gridCrossings(pts[i - 1], pts[i])) {
      const s = d[i - 1] + t * (d[i] - d[i - 1]);
      if (!near(s)) {
        all.push({ d: s, key });
      }
    }
  }
  all.sort((p, q) => p.d - q.d);
  const out: Support[] = [];
  for (const s of all) {
    const last = out.at(-1);
    if (!last || s.d - last.d >= MIN_SPAN_M) {
      out.push(s);
    } else if (s.key === null && last.key !== null) {
      out[out.length - 1] = s; // a mapped mast over the grid's
    }
  }
  return out;
}

/**
 * The stations the wires hang between: the supports, and a virtual one a
 * span beyond each end (a piece cut at a seam hangs on towards its
 * neighbour's support). Empty without a support.
 */
export function wireStations(supports: readonly Support[]): number[] {
  const s = supports.map((p) => p.d);
  if (s.length === 0) {
    return [];
  }
  const n = s.length;
  const first = n > 1 ? s[1] - s[0] : SUPPORT_GRID_M;
  const last = n > 1 ? s[n - 1] - s[n - 2] : SUPPORT_GRID_M;
  return [s[0] - first, ...s, s[n - 1] + last];
}

/** The span around station `d` and how far along it (0..1); null outside
 *  the stations. */
function spanAt(
  stations: readonly number[],
  d: number
): { i: number; span: number; t: number } | null {
  for (let i = 1; i < stations.length; i++) {
    if (d <= stations[i]) {
      const span = stations[i] - stations[i - 1];
      if (span <= 0 || d < stations[i - 1]) {
        return null;
      }
      return { i, span, t: (d - stations[i - 1]) / span };
    }
  }
  return null;
}

/** How far the messenger hangs below its support height at station `d`:
 *  a parabola over each span, deeper with the span's square. Half the
 *  nominal sag where no station holds it. */
export function messengerDrop(stations: readonly number[], d: number): number {
  const at = spanAt(stations, d);
  if (!at) {
    return MESSENGER_SAG_M / 2;
  }
  const sag = Math.min(
    MESSENGER_SAG_M * (at.span / SUPPORT_GRID_M) ** 2,
    MAX_SAG_M
  );
  return sag * 4 * at.t * (1 - at.t);
}

/**
 * Which side the contact wire is pulled to at each wire station
 * (`wireStations`, ±1): at a grid support by its grid line's parity, so
 * two tiles drawing one line agree at their seam; at a mapped mast the
 * other side from the support before it (after it, at the run's start);
 * at a virtual end station the other side from its neighbour.
 */
export function staggerSides(supports: readonly Support[]): number[] {
  const side = supports.map((p): number => {
    if (p.key === null) {
      return 0;
    }
    return Number(p.key.slice(2)) % 2 === 0 ? 1 : -1;
  });
  for (let i = 1; i < side.length; i++) {
    if (side[i] === 0) {
      side[i] = -side[i - 1];
    }
  }
  for (let i = side.length - 1; i >= 0; i--) {
    if (side[i] === 0) {
      side[i] = i + 1 < side.length ? -side[i + 1] : 1;
    }
  }
  if (side.length === 0) {
    return [];
  }
  return [-side[0], ...side, -(side.at(-1) ?? 1)];
}

/** The contact wire's offset across the track at station `d` (m, along
 *  the run's lateral): STAGGER_M to each station's side (`staggerSides`),
 *  straight between them. */
export function staggerAt(
  stations: readonly number[],
  sides: readonly number[],
  d: number
): number {
  const at = spanAt(stations, d);
  if (!at) {
    return 0;
  }
  const a = sides[at.i - 1] ?? 0;
  const b = sides[at.i] ?? 0;
  return STAGGER_M * (a + (b - a) * at.t);
}

/** One track's support on a grid line, as the cross-sections see it. */
export interface SectionMember {
  /** the contact wire's height there */
  h: number;
  /** which track (the caller's index) and the support's index on it */
  track: number;
  support: number;
  /** the unit direction of the track */
  tx: number;
  tz: number;
  x: number;
  z: number;
}

/** Where along its grid line a member stands (the other axis). */
function along(key: string, m: SectionMember): number {
  return key.startsWith("x") ? m.z : m.x;
}

/**
 * The supports on one grid line (`key`) grouped into cross-sections: the
 * tracks side by side within GROUP_GAP_M of each other along the line,
 * parallel (PARALLEL_COS) and on one level (GROUP_LEVEL_M), ordered along
 * it.
 */
export function crossSections(
  key: string,
  members: readonly SectionMember[]
): SectionMember[][] {
  const sorted = [...members].sort((p, q) => along(key, p) - along(key, q));
  const out: SectionMember[][] = [];
  for (const m of sorted) {
    const group = out.at(-1);
    const prev = group?.at(-1);
    const joins =
      group !== undefined &&
      prev !== undefined &&
      along(key, m) - along(key, prev) <= GROUP_GAP_M &&
      Math.abs(m.tx * group[0].tx + m.tz * group[0].tz) >= PARALLEL_COS &&
      Math.abs(m.h - prev.h) <= GROUP_LEVEL_M;
    if (joins) {
      group.push(m);
    } else {
      out.push([m]);
    }
  }
  return out;
}

/** A mast and what it holds: the track member it stands beside (its
 *  cantilever's), or several (a portal's beam between two masts). */
export interface MastPlan {
  /** the mast's foot (world x, z) */
  x: number;
  z: number;
  /** the mast's head above which datum: the highest messenger support of
   *  the members it holds, + MAST_HEAD_M (or the portal beam's height) */
  top: number;
}

/** What a cross-section stands: masts with a cantilever each over their
 *  track, or a portal's two masts and the beam between them. */
export type SectionPlan =
  | { kind: "cantilever"; masts: { mast: MastPlan; member: SectionMember }[] }
  | { kind: "portal"; beam: number; masts: [MastPlan, MastPlan] };

/** The unit vector from b to a (null where they meet). */
function away(a: XZ, b: XZ): XZ | null {
  const l = Math.hypot(a.x - b.x, a.z - b.z);
  return l > 1e-6 ? { x: (a.x - b.x) / l, z: (a.z - b.z) / l } : null;
}

/** The right of a member's track as the map shows it, north up (world z
 *  runs south): the side its mast stands on alone. */
function right(m: SectionMember): XZ {
  return { x: -m.tz, z: m.tx };
}

/**
 * The supports a cross-section stands (`crossSections`): three tracks or
 * more under a portal, its masts MAST_OFFSET_M beyond the outer ones and
 * its beam PORTAL_CLEAR_M over the highest messenger; one or two tracks
 * each on a mast of its own on its outer side (a track alone: its right),
 * its head MAST_HEAD_M over its messenger.
 */
export function sectionPlan(group: readonly SectionMember[]): SectionPlan {
  const support = (m: SectionMember) => m.h + SYSTEM_HEIGHT_M;
  const first = group[0];
  const last = group.at(-1) ?? first;
  const out = away(first, last) ?? right(first);
  const at = (m: SectionMember, dir: XZ, top: number): MastPlan => ({
    x: m.x + dir.x * MAST_OFFSET_M,
    z: m.z + dir.z * MAST_OFFSET_M,
    top,
  });
  if (group.length >= PORTAL_TRACKS) {
    const beam = Math.max(...group.map(support)) + PORTAL_CLEAR_M;
    return {
      kind: "portal",
      beam,
      masts: [at(first, out, beam), at(last, { x: -out.x, z: -out.z }, beam)],
    };
  }
  const masts = [
    { mast: at(first, out, support(first) + MAST_HEAD_M), member: first },
  ];
  if (group.length > 1) {
    masts.push({
      mast: at(last, { x: -out.x, z: -out.z }, support(last) + MAST_HEAD_M),
      member: last,
    });
  }
  return { kind: "cantilever", masts };
}

/**
 * The wires' heights under a bridge over the track (`soffit`, null where
 * none): the messenger lowered to run under the soffit, the system
 * height shrunk to MIN_SYSTEM_M, the contact wire never under
 * CONTACT_MIN_M over the rail head (`railHead`) — where the bridge leaves
 * less, the deck data are off, not the wire.
 */
export function underBridge(
  contact: number,
  messenger: number,
  railHead: number,
  soffit: number | null
): { contact: number; messenger: number } {
  if (soffit === null) {
    return { contact, messenger };
  }
  const m = Math.min(messenger, soffit - SOFFIT_CLEAR_M);
  const c = Math.max(
    Math.min(contact, m - MIN_SYSTEM_M),
    railHead + CONTACT_MIN_M
  );
  return { contact: c, messenger: Math.max(m, c + MIN_SYSTEM_M) };
}
