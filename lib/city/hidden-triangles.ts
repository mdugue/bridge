/**
 * Objects a planner's design stands in for, out of a building tile's index
 * and back (city-layer.ts `setHidden`, ADR 0054). Runtime only: kept out of
 * city-mesh.ts, which the buildings' bake walks, so a change here bakes
 * nothing again (scripts/bake-entries.ts).
 */

/**
 * Every object of the building trees `objects` belong to (by `root`): a
 * Building with its parts and what the bake hung on it — its plinths and
 * cornices, doors, dormers, shopfronts, passage linings —, which have no
 * footprint of their own to be found by.
 */
export function wholeTrees(
  root: ArrayLike<number>,
  objects: ReadonlySet<number>
): Set<number> {
  const trees = new Set<number>();
  for (const i of objects) {
    if (i >= 0 && i < root.length) {
      trees.add(root[i]);
    }
  }
  const whole = new Set<number>();
  if (trees.size === 0) {
    return whole;
  }
  for (let i = 0; i < root.length; i++) {
    if (trees.has(root[i])) {
      whole.add(i);
    }
  }
  return whole;
}

/**
 * Splits a triangle index into the triangles of objects `take` names and
 * the rest: what a design hides (city-layer.ts `setHidden`) leaves the
 * index, kept per object so it can come back.
 */
export function takeTriangles(
  index: ArrayLike<number>,
  featureIds: ArrayLike<number>,
  take: (objectIndex: number) => boolean
): { kept: Uint32Array; taken: Map<number, Uint32Array> } {
  const kept = new Uint32Array(index.length);
  const lists = new Map<number, number[]>();
  let n = 0;
  for (let t = 0; t < index.length; t += 3) {
    const object = featureIds[index[t]];
    if (take(object)) {
      let list = lists.get(object);
      if (!list) {
        list = [];
        lists.set(object, list);
      }
      list.push(index[t], index[t + 1], index[t + 2]);
    } else {
      kept[n++] = index[t];
      kept[n++] = index[t + 1];
      kept[n++] = index[t + 2];
    }
  }
  const taken = new Map<number, Uint32Array>();
  for (const [object, list] of lists) {
    taken.set(object, Uint32Array.from(list));
  }
  return { kept: kept.slice(0, n), taken };
}

/** An index with `extra` triangle lists appended (hidden objects back). */
export function appendTriangles(
  index: ArrayLike<number>,
  extra: readonly Uint32Array[]
): Uint32Array {
  let length = index.length;
  for (const list of extra) {
    length += list.length;
  }
  const out = new Uint32Array(length);
  out.set(index);
  let at = index.length;
  for (const list of extra) {
    out.set(list, at);
    at += list.length;
  }
  return out;
}
