/**
 * The coarse terrain level's trees. Each terrain level carries its own:
 * the fine level every tree (vegetation-layer.ts), the coarse level a
 * third of them, drawn wider (coarse-crowns-layer.ts) — and the tile
 * renderer shows one level per place, so wherever there is ground there
 * are trees, at any scale and whichever level a device can hold. This is
 * a plan's generalization by selection: COARSE_TREE_SHARE of the trees,
 * chosen by a hash of where each stands, their crowns COARSE_TREE_WIDEN
 * wider so a wood still covers the ground it covers. The build
 * (scripts/bake-dressing.ts) stands every tree of a tile on the fine
 * level's ground and puts that third into the coarse level's dressing
 * file, the rest into the fine level's (lib/city/tree-table.ts) — so a
 * coarse crown is the very tree the fine level draws there. No THREE, no
 * DOM.
 */

/** The share of the trees the coarse level draws. */
export const COARSE_TREE_SHARE = 1 / 3;
/** How much wider it draws their crowns: as many square metres of crown
 *  as all the trees have (share × widen² = 1). */
export const COARSE_TREE_WIDEN = Math.sqrt(1 / COARSE_TREE_SHARE);

/** A PCG step on an unsigned 32-bit seed: [0, 1). */
function pcg(seed: number): number {
  const state = (Math.imul(seed, 747_796_405) + 2_891_336_453) >>> 0;
  const word =
    Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277_803_737) >>>
    0;
  return (((word >>> 22) ^ word) >>> 0) / 2 ** 32;
}

/**
 * Whether the coarse level draws the tree standing at world (x, z): a hash
 * of where it stands (to the decimetre), so a tile rebuilt keeps the same
 * trees and neighbours are chosen independently — no row or stripe of
 * trees goes as one.
 */
export function drawnCoarse(x: number, z: number): boolean {
  const seed =
    Math.imul(Math.round(x * 10), 73_856_093) ^
    Math.imul(Math.round(z * 10), 19_349_663);
  return pcg(seed >>> 0) < COARSE_TREE_SHARE;
}

/** What the stream knows of one tile's two terrain levels. */
export interface TileLevelsShown {
  /** the coarse level is on screen */
  coarse: boolean;
  /** the fine level is on screen */
  fine: boolean;
  /** the fine level's dressing hangs on it (its trees, if it has any) */
  fineDressed: boolean;
}

/**
 * Whether a tile's coarse crowns stand in on its fine level: while the fine
 * level is on screen and its own trees are not — queued behind the
 * dressings of the tiles nearer the camera, or never built because the
 * build failed. A phone shows the fine level the moment it loads, and the
 * tile went bare for as long as its dressing waited. The crowns are the
 * coarse level's own, loaded with it already (the renderer keeps a shown
 * tile's coarse level loaded): no byte more, on the GPU or the wire.
 */
export function coarseCrownsStandIn(t: TileLevelsShown): boolean {
  return t.fine && !t.coarse && !t.fineDressed;
}
