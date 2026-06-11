import type { CityJsonDocument } from "./types";

/**
 * Demolition on the data level: returns a copy of the CityJSON document
 * without the given object AND its whole building tree.
 *
 * In this dataset (Saxony LoD1) many Buildings carry no geometry themselves —
 * their BuildingParts do. Picking returns the part's id, so we climb to the
 * root via `parents` and remove the root plus all descendants; otherwise a
 * demolished building would leave orphaned parts (or vice versa).
 *
 * The input document is not mutated; `vertices` etc. are shared by reference.
 */
export function filterCityObject(
  cityData: CityJsonDocument,
  objectId: string
): CityJsonDocument {
  const objects = cityData.CityObjects;
  if (!objects[objectId]) {
    return cityData;
  }

  // Climb to the root of the building tree (cycle-guarded).
  let rootId = objectId;
  const visited = new Set<string>();
  while (!visited.has(rootId)) {
    visited.add(rootId);
    const parentId = objects[rootId]?.parents?.[0];
    if (!(parentId && objects[parentId])) {
      break;
    }
    rootId = parentId;
  }

  // Collect the root and all descendants.
  const doomed = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || doomed.has(id) || !objects[id]) {
      continue;
    }
    doomed.add(id);
    for (const childId of objects[id].children ?? []) {
      stack.push(childId);
    }
  }

  const remaining: CityJsonDocument["CityObjects"] = {};
  for (const [id, obj] of Object.entries(objects)) {
    if (!doomed.has(id)) {
      remaining[id] = obj;
    }
  }
  return { ...cityData, CityObjects: remaining };
}
