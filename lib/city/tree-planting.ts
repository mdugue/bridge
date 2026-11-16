/**
 * A register tree's age from its planting year: a fact the build's tree
 * table reads with the tree (lib/city/tree-inventory.ts), apart from the
 * look an age gives (lib/city/tree-age.ts). No THREE, no DOM.
 */

/** A tree's age (years) in `year`, or undefined without a planting year. */
export function treeAge(
  planted: number | undefined,
  year: number
): number | undefined {
  return planted === undefined ? undefined : Math.max(year - planted, 0);
}
