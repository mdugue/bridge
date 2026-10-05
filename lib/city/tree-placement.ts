/**
 * Where the canopy and row trees stand, and how big: the placements the
 * vegetation layer (app/_components/vegetation-layer.ts) draws, and the
 * build step reproduces to choose the trees a small-scale Modell picture
 * keeps (lib/city/coarse-crowns.ts, prepare-data.ts). One owner, so both
 * sides place every tree at the very same float. No THREE, no DOM.
 */
import type { CanopyFeature, MonumentFeature, VegRowFeature } from "./features";
import { epsgToWorld, type RecenterOffset } from "./ground-clamp";
import { onRelief } from "./monuments";
import { samplePolyline } from "./polyline";
import type { RasterSampler } from "./raster-sampler";

/**
 * Veto on a row or canopy tree at EPSG (x, y) with its measured height `h`
 * (canopy points only): false drops it because a surveyed inventory tree
 * already stands there (lib/city/tree-inventory.ts `inventoryCovers`).
 */
export type TreeVeto = (x: number, y: number, h?: number) => boolean;

/** Deterministic [0,1) jitter so the layer rebuilds identically. */
export function hash(i: number): number {
  const s = Math.sin(i * 12.9898) * 43_758.5453;
  return s - Math.floor(s);
}

/**
 * Edge length (m) of a vegetation chunk. Each chunk is its own instanced
 * set with a tight bounding sphere, so three frustum-culls whole chunks
 * that are behind or beside the camera out of BOTH the main and the shadow
 * pass — instead of the old all-or-nothing "one mesh per tile". Trades a
 * few hundred (mostly-culled) draw calls for a large drop in processed
 * triangles.
 */
export const CHUNK_SIZE = 250;
/** Metres between trees along a row. */
export const TREE_SPACING = 9;
/** Metres between hedge segments. */
export const HEDGE_SPACING = 1.1;
/** Approx visual height of an unscaled tree; canopy scale = h / this. */
export const BASE_TREE_H = 5.8;

/**
 * One tree or hedge segment in the Y-up scene frame. `x` and `z` are the
 * float32 the instance matrix will hold (Math.fround): the selection by
 * scale (`treeRank`) and the colour jitter hash exactly what the GPU and
 * the build step see.
 */
export interface Placement {
  /** DOP NDVI 0..1 at this point (lush↔dry crown colour); undefined = no raster */
  ndvi?: number;
  rot: number;
  s: number;
  x: number;
  y: number;
  z: number;
}

/** The ground the placements stand on and the recenter offset. */
export interface PlacementContext {
  /** ground height (m) at EPSG (x, y), null off the ground */
  heightAt: (x: number, y: number) => number | null;
  offset: RecenterOffset;
}

/** The world (Y-up) position of EPSG (x, y), as the instance matrix holds it. */
function worldOf(
  ex: number,
  ey: number,
  offset: RecenterOffset
): { x: number; z: number } {
  const w = epsgToWorld(ex, ey, offset);
  return { x: Math.fround(w.x), z: Math.fround(w.z) };
}

/**
 * The ATKIS veg04 rows resampled and dropped onto the ground (EPSG ->
 * world): a tree every TREE_SPACING m, a hedge segment every HEDGE_SPACING.
 * A row tree an inventory tree stands on is left out (`keepTree`); hedges
 * never are.
 */
export function rowPlacements(
  features: VegRowFeature[],
  ctx: PlacementContext,
  ndviAt?: RasterSampler,
  keepTree?: TreeVeto
): { hedges: Placement[]; trees: Placement[] } {
  const trees: Placement[] = [];
  const hedges: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const isHedge = f.properties?.kind === "hedge";
    const pts = samplePolyline(
      f.geometry.coordinates,
      isHedge ? HEDGE_SPACING : TREE_SPACING
    );
    for (let i = 0; i < pts.length; i++) {
      const [ex, ey] = pts[i];
      if (!isHedge && keepTree && !keepTree(ex, ey)) {
        continue; // an inventory tree stands here
      }
      const ground = ctx.heightAt(ex, ey);
      if (ground === null) {
        continue; // off-tile or NoData
      }
      const seed = ex * 0.13 + ey * 0.07 + i;
      const w = worldOf(ex, ey, ctx.offset);
      const place: Placement = {
        x: w.x,
        y: ground,
        z: w.z,
        rot: isHedge ? hash(seed) * 0.3 : hash(seed * 1.7) * Math.PI,
        s: isHedge ? 1 : 0.8 + hash(seed) * 0.6,
        ndvi: ndviAt?.(ex, ey),
      };
      (isHedge ? hedges : trees).push(place);
    }
  }
  return { trees, hedges };
}

/** Canopy points (DOM1-derived) → height-scaled tree placements. */
export function canopyPlacements(
  features: CanopyFeature[],
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
    // A point missing a numeric `h` (only the TS type, not the JSON, promises
    // one) would make scale NaN; Math.max/min don't clamp NaN, so the NaN
    // matrix poisons the chunk's bounding sphere and the whole cell culls.
    const rawH = f.properties?.h ?? Number.NaN;
    const h = Number.isFinite(rawH) ? rawH : BASE_TREE_H;
    const seed = ex * 0.13 + ey * 0.07;
    const w = worldOf(ex, ey, ctx.offset);
    out.push({
      x: w.x,
      y: ground,
      z: w.z,
      rot: hash(seed * 1.7) * Math.PI,
      // Scale the whole tree to the measured canopy height (± a touch).
      s: Math.min(Math.max(h / BASE_TREE_H, 0.5), 7) * (0.9 + hash(seed) * 0.2),
      ndvi: ndviAt?.(ex, ey),
    });
  }
  return out;
}

/** The canopy without the "trees" the DOM1 bake planted on a measured
 *  monument (lib/city/monuments.ts `onRelief`). */
export function offMonuments<F extends CanopyFeature>(
  canopy: F[],
  monuments: MonumentFeature[]
): F[] {
  const reliefs = monuments.flatMap((m) =>
    m.properties?.relief ? [m.properties.relief] : []
  );
  if (reliefs.length === 0) {
    return canopy;
  }
  return canopy.filter((f) => {
    const [x, y] = f.geometry.coordinates;
    return !onRelief(reliefs, x, y);
  });
}

/** The CHUNK_SIZE cell a Y-up world position falls in. */
export function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}

/** Groups Y-up items into CHUNK_SIZE cells so each becomes its own mesh. */
export function bucketByCell<T extends { x: number; z: number }>(
  items: T[]
): T[][] {
  const cells = new Map<string, T[]>();
  for (const p of items) {
    const key = cellKey(p.x, p.z);
    const cell = cells.get(key);
    if (cell) {
      cell.push(p);
    } else {
      cells.set(key, [p]);
    }
  }
  return [...cells.values()];
}
