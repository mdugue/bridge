/**
 * A register tree's age as its look: a young tree thin (a sapling still on
 * its stakes), an old one with a mighty foot. The age comes from the register's planting year (`y`,
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

export interface AgeLook {
  /** the trunk girth's factor where no trunk diameter was measured */
  girth: number;
  /** the tree stands between stakes */
  staked: boolean;
}

const MATURE: Readonly<AgeLook> = { girth: 1, staked: false };

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
    };
  }
  if (age > OLD_YEARS) {
    const old = unit((age - OLD_YEARS) / (ANCIENT_YEARS - OLD_YEARS));
    return {
      girth: 1 + (OLD_GIRTH - 1) * old,
      staked: false,
    };
  }
  return MATURE;
}
