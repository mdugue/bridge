/**
 * A register tree's age as its look: a young tree thin and light green (a
 * sapling still on its stakes), an old one deep green with a mighty foot. The age comes from the register's planting year (`y`,
 * pipeline/bake/trees.py `planting_year`: Dresden's recorded age, the
 * others' planting year); the measured sizes stay as they are — height and
 * crown already grow with the tree, so the age adds what they do not say.
 *
 * Pure: no THREE, no DOM.
 */

/** Below this age (years) a tree stands between its stakes. */
export const STAKED_YEARS = 5;
/** Up to this age a tree is still young. */
export const YOUNG_YEARS = 15;
/** From this age a tree counts as old … */
export const OLD_YEARS = 80;
/** … and at this one it is as old as it looks. */
const ANCIENT_YEARS = 150;

/** A sapling's trunk against the one its height would give. */
const YOUNG_GIRTH = 0.6;
/** An ancient tree's trunk against the one its height would give. */
const OLD_GIRTH = 1.3;
/** A sapling's leaves: fresher, lighter, a touch yellower (hue, saturation,
 *  lightness offsets on the crown's HSL, at age 0, fading out by
 *  YOUNG_YEARS). */
const YOUNG_LEAF: readonly [number, number, number] = [-0.025, 0.08, 0.1];
/** An ancient crown: deeper and duller (at ANCIENT_YEARS). */
const OLD_LEAF: readonly [number, number, number] = [0.01, -0.05, -0.1];

export interface AgeLook {
  /** the trunk girth's factor where no trunk diameter was measured */
  girth: number;
  /** the tree stands between stakes */
  staked: boolean;
  /** the crown's lean: hue, saturation and lightness offsets on its HSL */
  leaf: readonly [number, number, number];
}

const MATURE: Readonly<AgeLook> = { girth: 1, staked: false, leaf: [0, 0, 0] };

const scaled = (
  v: readonly [number, number, number],
  k: number
): [number, number, number] => [v[0] * k, v[1] * k, v[2] * k];

const unit = (v: number) => Math.min(Math.max(v, 0), 1);

/** A tree's age (years) in `year`, or undefined without a planting year. */
export function treeAge(
  planted: number | undefined,
  year: number
): number | undefined {
  return planted === undefined ? undefined : Math.max(year - planted, 0);
}

/** The look of a tree of `age` years (undefined: unknown, as a mature one). */
export function ageLook(age: number | undefined): AgeLook {
  if (age === undefined || !Number.isFinite(age)) {
    return MATURE;
  }
  if (age < YOUNG_YEARS) {
    const young = 1 - unit(age / YOUNG_YEARS);
    return {
      girth: 1 - (1 - YOUNG_GIRTH) * young,
      staked: age < STAKED_YEARS,
      leaf: scaled(YOUNG_LEAF, young),
    };
  }
  if (age > OLD_YEARS) {
    const old = unit((age - OLD_YEARS) / (ANCIENT_YEARS - OLD_YEARS));
    return {
      girth: 1 + (OLD_GIRTH - 1) * old,
      staked: false,
      leaf: scaled(OLD_LEAF, old),
    };
  }
  return MATURE;
}
