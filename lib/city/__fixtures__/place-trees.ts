/**
 * Features placed on a ground, each through its one owner
 * (`canopyPlacement`, `inventoryTree`): what the layers' tests and the
 * cost probes feed the layers with. The product places trees in the build
 * (scripts/bake-trees.ts), never through these loops.
 */
import type { CanopyFeature, TreeFeature } from "../features";
import type { RecenterOffset } from "../ground-clamp";
import type { RasterSampler } from "../raster-sampler";
import { inventoryTree } from "../tree-inventory";
import type { InventoryTree } from "../tree-inventory";
import { canopyFacts, canopyPlacement } from "../tree-placement";
import type { Placement, PlacementContext, TreeVeto } from "../tree-placement";

/** Canopy points (DOM1-derived, and the laser scan's with a crown radius)
 *  → tree placements (`canopyPlacement`), each on the ground under it. */
export function canopyPlacements(
  features: (CanopyFeature & {
    properties: { c?: 1; h: number; l?: "e"; r?: number } | null;
  })[],
  ctx: PlacementContext,
  ndviAt?: RasterSampler,
  keepTree?: TreeVeto
): Placement[] {
  const out: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point") {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    if (keepTree && !keepTree(ex, ey, f.properties?.h)) {
      continue; // an inventory tree stands here
    }
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    out.push(
      canopyPlacement(
        ex,
        ey,
        ground,
        canopyFacts(f),
        ctx.offset,
        ndviAt?.(ex, ey)
      )
    );
  }
  return out;
}

/**
 * The register's trees placed on the ground (EPSG → world), in file order;
 * one off the ground is left out. The build reads them so to choose which
 * the coarse level draws and to bake each one's ground
 * (scripts/bake-trees.ts).
 */
export function inventoryTrees(
  features: TreeFeature[],
  ctx: {
    heightAt: (x: number, y: number) => number | null;
    offset: RecenterOffset;
  },
  ndviAt?: RasterSampler,
  year = new Date().getFullYear()
): InventoryTree[] {
  const out: InventoryTree[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point" || !f.properties) {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    out.push(
      inventoryTree(
        ex,
        ey,
        ground,
        f.properties,
        ctx.offset,
        ndviAt?.(ex, ey),
        year
      )
    );
  }
  return out;
}
