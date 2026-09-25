/**
 * Pure placement math for individually surveyed trees — a tree inventory such
 * as the Dresden street-tree cadastre (pipeline/bake/trees.py): each tree's
 * crown and trunk extents from its height, crown diameter and archetype, and
 * the footprint index that lets the canopy/row trees step aside where an
 * inventory tree already stands. No THREE, no DOM.
 *
 * The archetype ids are the bake's (pipeline/bake/tree_archetypes.py). They are an
 * illustrator's silhouettes, not botany: the cadastre's own height and crown
 * diameter already carry a tree's proportions (a 'Fastigiata' oak is recorded
 * 15 m tall and 4 m wide), so an archetype decides only what the scale cannot
 * — where the crown starts on the trunk, and which crown geometry draws it.
 */

export const TREE_ARCHETYPES = [
  "round",
  "oval",
  "columnar",
  "conifer",
  "weeping",
  "small",
] as const;
export type TreeArchetype = (typeof TREE_ARCHETYPES)[number];

/**
 * The crown geometries the layer builds. Round, oval and small ornamentals
 * share the lobed broadleaf crown (their difference is proportion, which the
 * per-instance scale carries); only the silhouettes a scale cannot make get
 * a geometry of their own — so a chunk costs at most one draw call per shape
 * present, not one per archetype.
 */
export const CROWN_SHAPES = ["broad", "spindle", "cone", "weep"] as const;
export type CrownShape = (typeof CROWN_SHAPES)[number];

export const ARCHETYPE_SHAPE: Record<TreeArchetype, CrownShape> = {
  round: "broad",
  oval: "broad",
  columnar: "spindle",
  conifer: "cone",
  weeping: "weep",
  small: "broad",
};

/** Fraction of the tree's height at which the crown starts (clear stem).
 *  Weeping: the hem of the hanging curtain. */
const CROWN_BASE: Record<TreeArchetype, number> = {
  round: 0.33,
  oval: 0.28,
  columnar: 0.14,
  conifer: 0.08,
  weeping: 0.18,
  small: 0.3,
};
/** Globe cultivars ('Globosum', 'Umbraculifera') are a ball on a stem. */
const GLOBE_CROWN_BASE = 0.45;
/** How far into the crown the trunk reaches (fraction of the crown depth);
 *  a weeping tree's stem carries the dome above the curtain. */
const TRUNK_INTO_CROWN: Record<TreeArchetype, number> = {
  round: 0.35,
  oval: 0.35,
  columnar: 0.3,
  conifer: 0.45,
  weeping: 0.7,
  small: 0.3,
};

/** Clamp for the bake's heights (m); the bake clamps too — this guards a
 *  hand-edited or foreign artifact. */
const H_RANGE: [number, number] = [1.5, 40];
const D_RANGE: [number, number] = [0.8, 30];

export function archetypeOf(id: number | undefined): TreeArchetype {
  return TREE_ARCHETYPES[id ?? 0] ?? "round";
}

/** Where one tree's crown and trunk sit, in metres above its ground point. */
export interface TreeExtents {
  crownBase: number;
  crownTop: number;
  crownWidth: number;
  trunkTop: number;
}

function clamp(v: number, [lo, hi]: [number, number]): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Crown and trunk extents for one tree. A non-finite height or diameter
 * falls back to a modest street tree rather than poisoning the instance
 * matrix (a NaN there culls the whole chunk — see vegetation-layer.ts).
 */
export function treeExtents(
  h: number,
  d: number,
  archetype: TreeArchetype,
  globe = false
): TreeExtents {
  const height = clamp(Number.isFinite(h) ? h : 8, H_RANGE);
  const width = clamp(Number.isFinite(d) ? d : height * 0.55, D_RANGE);
  const base = height * (globe ? GLOBE_CROWN_BASE : CROWN_BASE[archetype]);
  return {
    crownBase: base,
    crownTop: height,
    crownWidth: width,
    trunkTop: base + (height - base) * TRUNK_INTO_CROWN[archetype],
  };
}

/**
 * The shared trunk geometry (vegetation-layer.ts buildTrunkGeo) is a
 * cylinder of these radii (m) at the unit scale, tapering from the foot to
 * the top; its instance scale is (girth, trunkTop / TRUNK_H, girth).
 */
export const TRUNK_FOOT_R = 0.16;
export const TRUNK_TOP_R = 0.09;
/** The cylinder's height segments: a ring of vertices at every fifth of
 *  the trunk, straight faces between them. */
export const TRUNK_ROWS = 5;
/** The root flare: the rings below this fraction of the trunk widen,
 *  up to 1 + TRUNK_FLARE at the ground. */
const TRUNK_FLARE_TO = 0.16;
const TRUNK_FLARE = 0.9;

/** How much the trunk's rings widen at `t` (0 the foot, 1 the top). */
export function trunkFlare(t: number): number {
  return t < TRUNK_FLARE_TO
    ? 1 + ((TRUNK_FLARE_TO - t) / TRUNK_FLARE_TO) * TRUNK_FLARE
    : 1;
}

function ringRadius(t: number): number {
  return (TRUNK_FOOT_R - (TRUNK_FOOT_R - TRUNK_TOP_R) * t) * trunkFlare(t);
}

/**
 * The unit trunk's radius at `t` (0 the foot, 1 the top) as drawn: the
 * faces run straight from ring to ring, so it is the rings' radii (taper ×
 * flare) interpolated — not the taper alone. On a tall tree breast height
 * falls in the bottom segment, whose foot ring is flared: the taper alone
 * understated the radius there and so drew a measured trunk too thick.
 */
export function trunkRadiusAt(t: number): number {
  const u = Math.min(Math.max(t, 0), 1) * TRUNK_ROWS;
  const i = Math.min(Math.floor(u), TRUNK_ROWS - 1);
  const f = u - i;
  return (
    ringRadius(i / TRUNK_ROWS) * (1 - f) + ringRadius((i + 1) / TRUNK_ROWS) * f
  );
}
/** Breast height (m), where a cadastre measures the trunk. */
const BREAST_HEIGHT = 1.3;
/** A flat-shaded seven-sided trunk without bark reads thinner than the real
 *  one of the same width; this much wider it reads right. */
const TRUNK_STYLE = 1.3;
const GIRTH_RANGE: [number, number] = [0.3, 5];

/**
 * The trunk's horizontal instance scale. With a measured diameter at breast
 * height (`dbhCm`, the cadastre's `stammdurchmesser_akt` or an OSM
 * circumference) the geometry's radius at 1.3 m is fitted to it (× the style
 * factor); without one, the girth follows the tree's height, as before.
 */
export function trunkGirth(ext: TreeExtents, dbhCm?: number): number {
  if (dbhCm === undefined || !Number.isFinite(dbhCm) || dbhCm <= 0) {
    return clamp((ext.crownTop / 5.8) * 0.8, [0.45, 5]);
  }
  const unitR = trunkRadiusAt(BREAST_HEIGHT / Math.max(ext.trunkTop, 0.1));
  return clamp((dbhCm / 200 / unitR) * TRUNK_STYLE, GIRTH_RANGE);
}

/** Radius (m) around an inventory tree inside which a canopy or row tree is
 *  taken to be the same tree: its crown radius, but never less than half the
 *  canopy bake's 7 m grid (the tallest-pixel pick wanders within its cell),
 *  and never more than the index cell (so a 3×3 lookup is exhaustive). */
export const MIN_FOOTPRINT_R = 3.5;
export const FOOTPRINT_CELL = 16;

export function footprintRadius(d: number): number {
  const r = Number.isFinite(d) ? d / 2 : 0;
  return Math.min(Math.max(r, MIN_FOOTPRINT_R), FOOTPRINT_CELL);
}

export interface TreeFootprint {
  /** height (m); a canopy point clearly taller than this is another tree */
  h: number;
  r: number;
  x: number;
  y: number;
}

/**
 * A canopy point overtops an inventory tree — and is therefore a different
 * tree, not a second sample of the same one — when it is taller by more than
 * max(5 m, 30 %). The cadastre-vs-DOM1 height agreement sets the scale: a
 * median absolute difference of 2.8 m (scripts/eval/kataster-eval.py), so
 * 5 m is about two of those. Only ~2.6 % of the covered canopy points clear
 * it, typically a big park tree beside a young planting.
 */
export function overtops(canopyH: number, treeH: number): boolean {
  return canopyH > treeH + Math.max(5, 0.3 * treeH);
}

/**
 * A spatial hash over inventory trees: `covers(x, y, h)` is true when (x, y)
 * (EPSG) lies inside a tree's footprint radius — and, when the caller knows
 * the height `h` of what stands there, that thing does not overtop the tree.
 * Cells are FOOTPRINT_CELL wide and radii are clamped to it, so the 3×3
 * neighbourhood is exhaustive.
 */
export function footprintIndex(
  trees: TreeFootprint[]
): (x: number, y: number, h?: number) => boolean {
  const cells = new Map<string, TreeFootprint[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const t of trees) {
    const k = key(
      Math.floor(t.x / FOOTPRINT_CELL),
      Math.floor(t.y / FOOTPRINT_CELL)
    );
    const cell = cells.get(k);
    if (cell) {
      cell.push(t);
    } else {
      cells.set(k, [t]);
    }
  }
  const inside = (t: TreeFootprint, x: number, y: number, h?: number) => {
    const r = Math.min(t.r, FOOTPRINT_CELL);
    if ((t.x - x) ** 2 + (t.y - y) ** 2 > r * r) {
      return false;
    }
    return h === undefined || !Number.isFinite(h) || !overtops(h, t.h);
  };
  return (x, y, h) => {
    const cx = Math.floor(x / FOOTPRINT_CELL);
    const cy = Math.floor(y / FOOTPRINT_CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const t of cells.get(key(cx + dx, cy + dy)) ?? []) {
          if (inside(t, x, y, h)) {
            return true;
          }
        }
      }
    }
    return false;
  };
}
