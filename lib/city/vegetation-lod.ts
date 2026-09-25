/**
 * Which crown each vegetation chunk draws, decided once per frame over every
 * loaded tile together. No THREE, no DOM.
 *
 * Three tiers per 250 m chunk:
 * - `rich`: the multi-tuft crown (~1 440 triangles) — near the camera only,
 *   and only while the whole site's rich trees fit RICH_TREE_BUDGET. A forest
 *   chunk holds up to ~1 300 trees (the canopy bake plants one per 7 m cell),
 *   so a distance rule alone put ~10 000 rich crowns on screen in the Dresdner
 *   Heide — tens of millions of triangles, paid again by the shadow pass, and
 *   enough to stall the GPU until the browser dropped the context.
 * - `mid`: the lobed icosphere (180 triangles) plus the trunk (84).
 * - `far`: a coarser crown (80 triangles), no trunk (sub-pixel out there), and
 *   dense chunks thinned to every other tree at a wider crown.
 *
 * Every boundary has hysteresis (in/out distances, and a head start in the
 * budget for chunks that are already rich) so a chunk on the line does not
 * flicker between tiers.
 */

export type CrownTier = "far" | "mid" | "rich";

export interface ChunkLodState {
  /** multi-tuft crowns enabled for this chunk's tile (the look toggle) */
  allowRich: boolean;
  /** the tier currently shown */
  current: CrownTier;
  /** metres from the camera to the chunk's NEAREST tree (≥ 0) */
  near: number;
  /** trees in the chunk */
  trees: number;
}

export const RICH_IN_M = 220;
export const RICH_OUT_M = 300;
export const FAR_IN_M = 650;
export const FAR_OUT_M = 550;
/** Rich crowns on screen at most, over the whole site (≈ 3.6 M triangles). */
export const RICH_TREE_BUDGET = 2500;
/** A rich chunk competes for the budget as if it were this much closer. */
const RICH_KEEP_BONUS_M = 60;

function distanceTier(c: ChunkLodState): "far" | "mid" {
  const farFrom = c.current === "far" ? FAR_OUT_M : FAR_IN_M;
  return c.near > farFrom ? "far" : "mid";
}

/**
 * The tier for each chunk, in input order: the distance tier, upgraded to
 * `rich` for the nearest eligible chunks while their trees fit the budget.
 */
export function planCrownTiers(chunks: readonly ChunkLodState[]): CrownTier[] {
  const tiers: CrownTier[] = chunks.map(distanceTier);
  const candidates: { key: number; index: number }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const wasRich = c.current === "rich";
    if (c.allowRich && c.near < (wasRich ? RICH_OUT_M : RICH_IN_M)) {
      candidates.push({
        index: i,
        key: c.near - (wasRich ? RICH_KEEP_BONUS_M : 0),
      });
    }
  }
  candidates.sort((a, b) => a.key - b.key);
  let left = RICH_TREE_BUDGET;
  for (const { index } of candidates) {
    const { trees } = chunks[index];
    if (trees <= left) {
      tiers[index] = "rich";
      left -= trees;
    }
  }
  return tiers;
}

/** Chunks at least this dense (trees per chunk) are thinned in the far tier. */
export const FAR_THIN_MIN_TREES = 400;

/**
 * Whether tree `i` of a chunk stays in the far tier: all of a sparse chunk,
 * every other tree of a dense one (the kept crowns are drawn wider, so a
 * forest stays a closed canopy at a fraction of the triangles).
 */
export function keepInFarTier(i: number, chunkTrees: number): boolean {
  return chunkTrees < FAR_THIN_MIN_TREES || i % 2 === 0;
}
