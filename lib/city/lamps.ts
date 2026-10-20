/**
 * A street lamp's post height: the bake's (`h`, measured street by street
 * in DOM1 — pipeline/bake/lamp_heights.py), else the 5 m every post stood
 * at before. No THREE, no DOM.
 */

import type { LampFeature } from "./features";

/** A post's height (m) where the bake measured none. */
export const LAMP_POST_H = 5;

/** A post's height (m). */
export function postHeight(f: LampFeature): number {
  const h = f.properties?.h;
  return h !== undefined && Number.isFinite(h) && h > 0 ? h : LAMP_POST_H;
}
