import type { Mesh } from "three/webgpu";
import {
  CONTACT_WIRE_M,
  crossSections,
  MAST_HEAD_M,
  MAST_OFFSET_M,
  type MastPlan,
  messengerDrop,
  OVERPASS_CLEAR_M,
  type SectionMember,
  sectionPlan,
  staggerAt,
  staggerSides,
  type Support,
  supportStations,
  SYSTEM_HEIGHT_M,
  underBridge,
  wireStations,
} from "@/lib/city/catenary";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { type Mesh3, type P3, type Pt, quad } from "./mesh-kit";
import { addWire, wireMesh, wires, type Wires } from "./wire-ribbons";

/**
 * The main lines' overhead contact line (lib/city/catenary.ts), over the
 * tracks the rail layer draws with a contact line (`electrified` 1): the
 * contact wire, zig-zagging from support to support; the messenger,
 * sagging between them, with its droppers; at each support a mast beside
 * the track with its cantilever over it, or a portal over three tracks and
 * more. Under a bridge over the track no support stands, and the wires run
 * on under its soffit, the messenger lowered (`underBridge`). The wires are the trams' faint camera-facing ribbons
 * (wire-ribbons.ts, never cast); the masts and portal beams are slim steel
 * in the rail layer's mesh, and cast. Built per fine terrain tile with the
 * rails, freed with them; a support or a wire segment is drawn by the tile
 * that owns it (`owns`: the DLM's lines run past the tile edge, and the
 * neighbour draws them again).
 */

/** half-widths (m) of the drawn wires */
const WIRE_HALF = {
  contact: 0.007,
  messenger: 0.006,
  dropper: 0.003,
  arm: 0.03,
};
/** A mast's half-section and a portal beam's (m). */
const MAST_HALF = 0.17;
const BEAM_HALF = 0.2;
/** A mast's foot under the ground (m). */
const MAST_SINK = 0.3;
/** A mapped mast closer to its track than this (m) is mapped on it. */
const MIN_MAST_OFFSET_M = 2.5;
/** The droppers' and the wire points' step (m). */
const WIRE_STEP_M = 8;

/** One run of a track as the catenary hangs over it. */
export interface CatenaryRun {
  /** the structure under each point (a deck's or span's level) a mast
   *  there stands on, or null on the ground */
  deck: (number | null)[];
  /** each point's station along its line (m) */
  d: number[];
  /** the masts OSM maps on this run: [station, lateral from the run] (m,
   *  along (−tz, tx), the map's right) */
  mapped: readonly (readonly [number, number])[];
  /** the soffit of a bridge over each point, null where none */
  over: (number | null)[];
  /** the rail head per point (world) */
  pts: Pt[];
}

/** What the catenary is built into. */
export interface CatenaryParts {
  steel: Mesh3;
  wires: Wires;
}

type Ctx = GroundContext & { owns?: (x: number, y: number) => boolean };

/** The point, unit direction and structure at station `s` of a run. */
function pointAt(run: CatenaryRun, s: number) {
  const { d, pts } = run;
  let i = 1;
  while (i < d.length - 1 && d[i] < s) {
    i++;
  }
  const a = pts[i - 1];
  const b = pts[i];
  const span = d[i] - d[i - 1];
  const t = span > 0 ? Math.min(Math.max((s - d[i - 1]) / span, 0), 1) : 0;
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return {
    deck: run.deck[t < 0.5 ? i - 1 : i],
    over: run.over[t < 0.5 ? i - 1 : i],
    tx: (b.x - a.x) / l,
    tz: (b.z - a.z) / l,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function owned(ctx: Ctx, x: number, z: number): boolean {
  return !ctx.owns || ctx.owns(x + ctx.offset.cx, ctx.offset.cy - z);
}

/** A slim steel prism from a to b (half-section `half`), its four sides. */
function addBeam(acc: Mesh3, a: P3, b: P3, half: number): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) {
    return;
  }
  const t: P3 = [dx / l, dy / l, dz / l];
  // a side direction off the axis: across in plan, or x for a vertical
  const flat = Math.hypot(t[0], t[2]);
  const u: P3 = flat > 1e-3 ? [-t[2] / flat, 0, t[0] / flat] : [1, 0, 0];
  const v: P3 = [
    t[1] * u[2] - t[2] * u[1],
    t[2] * u[0] - t[0] * u[2],
    t[0] * u[1] - t[1] * u[0],
  ];
  const corner = (p: P3, su: number, sv: number): P3 => [
    p[0] + (u[0] * su + v[0] * sv) * half,
    p[1] + (u[1] * su + v[1] * sv) * half,
    p[2] + (u[2] * su + v[2] * sv) * half,
  ];
  const sides: [number, number, number, number, P3][] = [
    [1, 1, 1, -1, u],
    [-1, -1, -1, 1, [-u[0], -u[1], -u[2]]],
    [1, 1, -1, 1, v],
    [1, -1, -1, -1, [-v[0], -v[1], -v[2]]],
  ];
  for (const [su0, sv0, su1, sv1, n] of sides) {
    quad(
      acc,
      corner(a, su0, sv0),
      corner(b, su0, sv0),
      corner(b, su1, sv1),
      corner(a, su1, sv1),
      n
    );
  }
  // the ends (a mast's head seen from the air)
  for (const [p, n] of [
    [b, t],
    [a, [-t[0], -t[1], -t[2]] as P3],
  ] as const) {
    quad(
      acc,
      corner(p, 1, 1),
      corner(p, 1, -1),
      corner(p, -1, -1),
      corner(p, -1, 1),
      n
    );
  }
}

/** A mast's foot height: the structure the track rides there, else the
 *  ground at the mast. */
function footAt(ctx: Ctx, deck: number | null, x: number, z: number) {
  if (deck !== null) {
    return deck;
  }
  return ctx.heightAt(x + ctx.offset.cx, ctx.offset.cy - z);
}

/** A mast from its foot to `top` and the cantilever over its track: an
 *  arm at the messenger's support, a registration arm at the contact
 *  wire's. */
function addCantilever(
  out: CatenaryParts,
  ctx: Ctx,
  mast: MastPlan,
  over: { deck: number | null; h: number; x: number; z: number }
): void {
  const foot = footAt(ctx, over.deck, mast.x, mast.z);
  if (foot === null || !owned(ctx, mast.x, mast.z)) {
    return;
  }
  addBeam(
    out.steel,
    [mast.x, foot - MAST_SINK, mast.z],
    [mast.x, mast.top, mast.z],
    MAST_HALF
  );
  const support = over.h + SYSTEM_HEIGHT_M;
  addWire(
    out.wires,
    [
      { x: mast.x, y: support, z: mast.z },
      { x: over.x, y: support, z: over.z },
    ],
    WIRE_HALF.arm
  );
  addWire(
    out.wires,
    [
      { x: mast.x, y: over.h + 0.3, z: mast.z },
      { x: over.x, y: over.h, z: over.z },
    ],
    WIRE_HALF.arm / 2
  );
}

/** A portal: two masts, the beam between their heads, a hanger down to
 *  each messenger it holds. */
function addPortal(
  out: CatenaryParts,
  ctx: Ctx,
  beam: number,
  masts: readonly [MastPlan, MastPlan],
  group: readonly (SectionMember & { deck: number | null })[]
): void {
  const mx = (masts[0].x + masts[1].x) / 2;
  const mz = (masts[0].z + masts[1].z) / 2;
  if (!owned(ctx, mx, mz)) {
    return;
  }
  const feet = masts.map((m, k) =>
    footAt(ctx, group[k === 0 ? 0 : group.length - 1].deck, m.x, m.z)
  );
  if (feet[0] === null || feet[1] === null) {
    return;
  }
  masts.forEach((m, k) =>
    addBeam(
      out.steel,
      [m.x, (feet[k] as number) - MAST_SINK, m.z],
      [m.x, beam + BEAM_HALF, m.z],
      MAST_HALF
    )
  );
  addBeam(
    out.steel,
    [masts[0].x, beam, masts[0].z],
    [masts[1].x, beam, masts[1].z],
    BEAM_HALF
  );
  for (const m of group) {
    addWire(
      out.wires,
      [
        { x: m.x, y: beam - BEAM_HALF, z: m.z },
        { x: m.x, y: m.h + SYSTEM_HEIGHT_M, z: m.z },
      ],
      WIRE_HALF.dropper * 2
    );
  }
}

/** The wires over a run: the contact wire with its zig-zag, the messenger
 *  sagging between the stations, a dropper every WIRE_STEP_M. */
function addRunWires(
  out: CatenaryParts,
  ctx: Ctx,
  run: CatenaryRun,
  supports: readonly Support[]
): void {
  const stations = wireStations(supports);
  const sides = staggerSides(supports);
  const first = run.d[0];
  const last = run.d.at(-1) ?? first;
  const at = new Set<number>();
  for (let s = first; s < last; s += WIRE_STEP_M) {
    at.add(s);
  }
  at.add(last);
  for (const p of supports) {
    at.add(p.d);
  }
  const ss = [...at]
    .filter((s) => s >= first && s <= last)
    .sort((a, b) => a - b);
  const contact: Pt[] = [];
  const messenger: Pt[] = [];
  for (const s of ss) {
    const p = pointAt(run, s);
    const o = staggerAt(stations, sides, s);
    const h = underBridge(
      p.y + CONTACT_WIRE_M,
      p.y + CONTACT_WIRE_M + SYSTEM_HEIGHT_M - messengerDrop(stations, s),
      p.y,
      p.over
    );
    contact.push({ x: p.x - p.tz * o, y: h.contact, z: p.z + p.tx * o });
    messenger.push({ x: p.x, y: h.messenger, z: p.z });
  }
  for (let i = 1; i < ss.length; i++) {
    const a = contact[i - 1];
    const b = contact[i];
    if (!owned(ctx, (a.x + b.x) / 2, (a.z + b.z) / 2)) {
      continue;
    }
    addWire(out.wires, [a, b], WIRE_HALF.contact);
    addWire(out.wires, [messenger[i - 1], messenger[i]], WIRE_HALF.messenger);
    addWire(out.wires, [messenger[i], b], WIRE_HALF.dropper);
  }
}

/** Whether a bridge crosses over the run within OVERPASS_CLEAR_M of
 *  station `s`. */
function nearOverpass(run: CatenaryRun, s: number): boolean {
  return run.d.some(
    (d, i) => run.over[i] !== null && Math.abs(d - s) <= OVERPASS_CLEAR_M
  );
}

/**
 * The catenary over the runs (`CatenaryRun`): every run's supports
 * (`supportStations`, the mapped masts and the site's grid), the grid's
 * gathered by grid line into cross-sections (`crossSections`) and stood
 * as cantilevers or portals (`sectionPlan`), the mapped masts each with
 * its cantilever, then every run's wires.
 */
export function addCatenary(
  out: CatenaryParts,
  runs: readonly CatenaryRun[],
  ctx: Ctx
): void {
  const byLine = new Map<string, (SectionMember & { deck: number | null })[]>();
  const supports = runs.map((run, track) => {
    const mapped = run.mapped
      .filter(([s]) => s >= run.d[0] && s <= (run.d.at(-1) ?? 0))
      .map(([s]) => s);
    // a mapped mast stands where OSM says; the grid's none under a bridge
    const found = supportStations(run.pts, run.d, mapped).filter(
      (sp) => sp.key === null || !nearOverpass(run, sp.d)
    );
    found.forEach((sp, support) => {
      const p = pointAt(run, sp.d);
      const member = {
        deck: p.deck,
        h: p.y + CONTACT_WIRE_M,
        support,
        track,
        tx: p.tx,
        tz: p.tz,
        x: p.x,
        z: p.z,
      };
      if (sp.key === null) {
        const mappedAt =
          run.mapped.find(([s]) => Math.abs(s - sp.d) < 0.05)?.[1] ?? 0;
        // a mast mapped on the track itself stands beside it
        const offset =
          Math.abs(mappedAt) < MIN_MAST_OFFSET_M
            ? Math.sign(mappedAt || 1) * MAST_OFFSET_M
            : mappedAt;
        addCantilever(
          out,
          ctx,
          {
            x: p.x - p.tz * offset,
            z: p.z + p.tx * offset,
            top: member.h + SYSTEM_HEIGHT_M + MAST_HEAD_M,
          },
          member
        );
        return;
      }
      const line = byLine.get(sp.key);
      if (line) {
        line.push(member);
      } else {
        byLine.set(sp.key, [member]);
      }
    });
    return found;
  });
  for (const [key, members] of byLine) {
    for (const group of crossSections(key, members)) {
      const plan = sectionPlan(group);
      const full = group as (SectionMember & { deck: number | null })[];
      if (plan.kind === "portal") {
        addPortal(out, ctx, plan.beam, plan.masts, full);
      } else {
        for (const { mast, member } of plan.masts) {
          addCantilever(
            out,
            ctx,
            mast,
            member as SectionMember & { deck: number | null }
          );
        }
      }
    }
  }
  runs.forEach((run, k) => addRunWires(out, ctx, run, supports[k]));
}

/** The catenary's meshes: the wires (null when none) and the steel in
 *  `steelMesh` (the caller's: it is the rail layer's material). */
export function catenaryWires(parts: CatenaryParts): Mesh | null {
  return wireMesh(parts.wires, "rail-catenary");
}

export function catenaryParts(steel: Mesh3): CatenaryParts {
  return { steel, wires: wires() };
}
