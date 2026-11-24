/**
 * The tree layers fed with features, for the cost probes: the features
 * placed here on the probe's ground (the build places them for the viewer,
 * scripts/bake-trees.ts), then built as the viewer builds placed trees.
 */
import { buildTreeInventory } from "../../app/_components/tree-inventory-layer";
import type { TreeInventory } from "../../app/_components/tree-inventory-layer";
import { buildVegetation } from "../../app/_components/vegetation-layer";
import type {
  TreeInstance,
  VegetationControl,
} from "../../app/_components/vegetation-layer";
import {
  canopyPlacements,
  inventoryTrees,
} from "../../lib/city/__fixtures__/place-trees";
import type {
  CanopyFeature,
  TreeFeature,
  VegRowFeature,
} from "../../lib/city/features";
import { inventoryCovers } from "../../lib/city/tree-inventory";
import { rowPlacements } from "../../lib/city/tree-placement";
import type { PlacementContext, TreeVeto } from "../../lib/city/tree-placement";

export function placedInventory(
  trees: TreeFeature[],
  on: PlacementContext
): TreeInventory & { keepTree: TreeVeto } {
  const covers = inventoryCovers(trees);
  return {
    ...buildTreeInventory(inventoryTrees(trees, on), {}),
    keepTree: (x, y, h) => !covers(x, y, h),
  };
}

export function placedVegetation(
  f: {
    canopy: CanopyFeature[];
    extraTrees?: TreeInstance[];
    keepTree?: TreeVeto;
    rows: VegRowFeature[];
  },
  on: PlacementContext
): VegetationControl {
  return buildVegetation(
    {
      trees: [
        ...rowPlacements(
          f.rows.filter((r) => r.properties?.kind !== "hedge"),
          on,
          undefined,
          f.keepTree
        ).trees,
        ...canopyPlacements(f.canopy, on, undefined, f.keepTree),
      ],
      extraTrees: f.extraTrees,
    },
    {}
  );
}
