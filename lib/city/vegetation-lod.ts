/**
 * Which crown each vegetation chunk draws, decided over every loaded tile
 * together on the viewer's 10 Hz pose tick — at once when the tiles in view
 * or the crown switch change, or the eye jumps (`createLodSchedule`). No
 * THREE, no DOM.
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
/**
 * A phone's share of it (≈ 1.2 M triangles, paid twice with the shadow
 * pass): the nearest street trees stay rich, a park's interior goes mid.
 */
export const PHONE_RICH_TREE_BUDGET = 800;
/** A rich chunk competes for the budget as if it were this much closer. */
const RICH_KEEP_BONUS_M = 60;

function distanceTier(c: ChunkLodState): "far" | "mid" {
  const farFrom = c.current === "far" ? FAR_OUT_M : FAR_IN_M;
  return c.near > farFrom ? "far" : "mid";
}

/**
 * The arrays a plan works in, kept between passes (`planCrownTiers`): a
 * pass over the site's ~1 000 chunks then allocates nothing of its own.
 */
export interface CrownPlanScratch {
  /** the plan's answer, one tier per chunk (rewritten by every pass) */
  tiers: CrownTier[];
  /** the rich candidates' chunk indices, nearest first */
  order: number[];
  /** each chunk's place in the budget's queue (its distance, less the
   *  bonus of a rich one) */
  keys: number[];
  byKey: (a: number, b: number) => number;
}

export function createCrownPlanScratch(): CrownPlanScratch {
  const keys: number[] = [];
  return { tiers: [], order: [], keys, byKey: (a, b) => keys[a] - keys[b] };
}

/**
 * The tier for each chunk, in input order: the distance tier, upgraded to
 * `rich` for the nearest eligible chunks while their trees fit the budget.
 * With `scratch` the answer is its `tiers`, rewritten in place.
 */
export function planCrownTiers(
  chunks: readonly ChunkLodState[],
  budget: number = RICH_TREE_BUDGET,
  scratch: CrownPlanScratch = createCrownPlanScratch()
): CrownTier[] {
  const { tiers, order, keys } = scratch;
  tiers.length = chunks.length;
  keys.length = chunks.length;
  order.length = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    tiers[i] = distanceTier(c);
    const wasRich = c.current === "rich";
    if (c.allowRich && c.near < (wasRich ? RICH_OUT_M : RICH_IN_M)) {
      keys[i] = c.near - (wasRich ? RICH_KEEP_BONUS_M : 0);
      order.push(i);
    }
  }
  // (a stable sort over ascending indices: a tie goes to the earlier chunk)
  order.sort(scratch.byKey);
  let left = budget;
  for (const index of order) {
    const { trees } = chunks[index];
    if (trees <= left) {
      tiers[index] = "rich";
      left -= trees;
    }
  }
  return tiers;
}

/**
 * How far the eye may move between two passes before the next one runs at
 * once rather than on the pose tick (m): well inside the narrowest
 * hysteresis band (RICH_OUT_M − RICH_IN_M, 80 m) and above what the fastest
 * flight covers in a tick (180 m/s, 18 m in 100 ms) — a teleport, a
 * placeAt, a snapshot applied, Modell's entry or exit trips it (and a
 * glide only where it outruns the tick); walking and flying never do.
 */
export const LOD_JUMP_M = 25;

/** A point in the scene (m), as three's vectors are. */
export interface LodEye {
  x: number;
  y: number;
  z: number;
}

/**
 * When the tiers are picked (`createLodSchedule`): on the pose tick, and
 * at once — in the frame it happens — when what they depend on changed.
 */
export interface LodSchedule {
  /**
   * Something the tiers depend on changed (the tiles in view, the crown
   * switch): the next frame picks them, not the next tick — a tile that
   * lands is born on its mid crowns and would show them for up to a tick.
   */
  force: () => void;
  /**
   * Whether this frame picks the tiers (`tick`: the pose tick is due):
   * never picked yet, forced, the tick, or the eye moved more than
   * LOD_JUMP_M since the last pass. A yes counts as the pass: `eye` is
   * where the next frames are measured from.
   */
  due: (tick: boolean, eye: LodEye) => boolean;
}

export function createLodSchedule(jumpM: number = LOD_JUMP_M): LodSchedule {
  let forced = true;
  const last = { x: 0, y: 0, z: 0 };
  const jumpSq = jumpM * jumpM;
  const jumped = (eye: LodEye) =>
    (eye.x - last.x) ** 2 + (eye.y - last.y) ** 2 + (eye.z - last.z) ** 2 >
    jumpSq;
  return {
    force: () => {
      forced = true;
    },
    due: (tick, eye) => {
      if (!(forced || tick || jumped(eye))) {
        return false;
      }
      forced = false;
      last.x = eye.x;
      last.y = eye.y;
      last.z = eye.z;
      return true;
    },
  };
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
