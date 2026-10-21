/**
 * A street lamp's post height: the bake's (`h`, measured street by street
 * in DOM1 — pipeline/bake/lamp_heights.py), else the 5 m every post stood
 * at before; and where a tall post's arm holds its head. No THREE, no DOM.
 */

import type { LampFeature } from "./features";

/** A post's height (m) where the bake measured none. */
export const LAMP_POST_H = 5;

/** A post's height (m). */
export function postHeight(f: LampFeature): number {
  const h = f.properties?.h;
  return h !== undefined && Number.isFinite(h) && h > 0 ? h : LAMP_POST_H;
}

/**
 * How far a mast's arm reaches out from its post (m): a fifth of its
 * height, within 1.2–2.5 m. Over the masts of 6.5–11 m DOM1 shows their
 * heads 1.7–2.0 m towards the carriageway in Hamburg (median), about a
 * metre in Dresden; the photos show arms of 1–2.5 m.
 */
export const ARM_REACH = { share: 0.2, min: 1.2, max: 2.5 } as const;

/** How far under the head (m) the arm leaves the post: it rises to it. */
export const ARM_DROP = 0.35;

/** A post's arm length (m) at its height `h`. */
export function armReach(h: number): number {
  return Math.min(Math.max(h * ARM_REACH.share, ARM_REACH.min), ARM_REACH.max);
}

/**
 * Where a post's head hangs off it, as an (east, north) offset in metres
 * along its arm (`arm`, the bake's compass bearing) — null for a head on top
 * of its post. A hung lamp or a wall lantern has no arm.
 */
export function armOffset(f: LampFeature): [number, number] | null {
  const p = f.properties;
  if (p?.arm === undefined || p.wire || p.wall) {
    return null;
  }
  const reach = armReach(postHeight(f));
  const rad = (p.arm * Math.PI) / 180;
  return [Math.sin(rad) * reach, Math.cos(rad) * reach];
}
