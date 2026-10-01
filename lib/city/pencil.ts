/**
 * The pencil's mark around an asked thing that has no clay to hatch (a
 * tree, a monument, a bridge; plan 049 phase 4): a loop drawn by hand on
 * the ground around it — or along a bridge's deck — the way one circles a
 * place on a paper map. It runs a little past its start and wavers a
 * little, never twice the same (seeded by where it stands). The scene
 * draws it as one screen-wide line (pencil-mark.ts). No THREE, no DOM.
 */
import type { AskSolid, Xyz } from "./ask-solids";

/** Lifted off what it lies on, so the ground does not swallow it (m). */
const LIFT = 0.2;
/** How much wider than the thing the loop is drawn. */
const ROOM = 1.2;
/** The loop goes on past its start by this much of a turn. */
const OVERRUN = 0.12;
/** Over a deck's edge: the parapet (rail-layer.ts, 0.85 m) and clear of it. */
const OVER_PARAPET = 1.6;
/** A segment of a resampled outline is at most this long (m). */
const STEP = 1.5;

/** The plain outline of a thing's solids, as a closed loop (world). */
export function outlineOf(solids: readonly AskSolid[]): Xyz[] {
  const first = solids[0];
  if (!first) {
    return [];
  }
  if ("cylinder" in first) {
    // a tree is its trunk and its crown: the crown's width, on the ground
    const widest = Math.max(
      ...solids.map((s) => ("cylinder" in s ? s.cylinder.r : 0))
    );
    const c = first.cylinder;
    return circle(c.x, c.y0 + LIFT, c.z, widest * ROOM);
  }
  if ("prism" in first) {
    const p = first.prism;
    return resample(p.ring.map(([x, z]) => ({ x, y: p.y0 + LIFT, z })));
  }
  // along the parapet's top, as the scene draws the deck: on the deck
  // itself the parapets hide it
  const s = first.slab;
  const top = s.ringTop;
  if (top && top.length >= s.ring.length) {
    return resample(
      s.ring.map(([x, z], i) => ({ x, y: top[i] + OVER_PARAPET, z }))
    );
  }
  return resample(s.ring.map(([x, z]) => ({ x, y: 0, z }))).map((p) => ({
    ...p,
    y: s.topAt(p.x, p.z) + OVER_PARAPET,
  }));
}

function circle(x: number, y: number, z: number, r: number): Xyz[] {
  const n = Math.max(24, Math.min(96, Math.round((2 * Math.PI * r) / 0.6)));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r };
  });
}

/** A ring with no segment longer than STEP (a deck follows its arch). */
function resample(ring: readonly Xyz[]): Xyz[] {
  const out: Xyz[] = [];
  const open =
    ring.length > 1 &&
    ring[0].x === ring.at(-1)?.x &&
    ring[0].z === ring.at(-1)?.z
      ? ring.slice(0, -1)
      : ring;
  open.forEach((a, i) => {
    const b = open[(i + 1) % open.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  });
  return out;
}

/** A seeded wobble in −1..1, slow along the loop. */
function wobble(u: number, seed: number): number {
  return (
    0.6 * Math.sin(u * Math.PI * 2 * 3 + seed) +
    0.4 * Math.sin(u * Math.PI * 2 * 7 + seed * 1.7)
  );
}

/**
 * The loop as a hand draws it: once around and a little past the start,
 * pushed out and in from its centre by a slow wobble of `waver` of its
 * size (at most `maxWaver` m), the second time round a touch wider — an
 * open polyline, ready for a line.
 */
export function pencilStroke(
  loop: readonly Xyz[],
  waver = 0.04,
  maxWaver = 0.6
): Xyz[] {
  if (loop.length < 3) {
    return [...loop];
  }
  const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length;
  const cz = loop.reduce((s, p) => s + p.z, 0) / loop.length;
  const seed = (Math.abs(cx * 0.37 + cz * 0.11) % 1) * Math.PI * 2;
  const n = loop.length;
  const total = Math.round(n * (1 + OVERRUN));
  const out: Xyz[] = [];
  for (let k = 0; k <= total; k++) {
    const p = loop[k % n];
    const u = k / n;
    const dx = p.x - cx;
    const dz = p.z - cz;
    const r = Math.hypot(dx, dz) || 1;
    const push = Math.min(r * waver, maxWaver) * (wobble(u, seed) + u * 0.8);
    out.push({ x: p.x + (dx / r) * push, y: p.y, z: p.z + (dz / r) * push });
  }
  return out;
}
