/**
 * Where the canopy and row trees stand, and how big: the placements the
 * vegetation layer (app/_components/vegetation-layer.ts) draws, and the
 * build step reproduces to choose the coarse level's trees
 * (lib/city/coarse-crowns.ts, scripts/coarse-crowns.ts). One owner, so a
 * coarse crown stands where its fine tree does. No THREE, no DOM.
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
/** The generic tree's top at scale 1 (the lobed crown's highest point,
 *  vegetation-layer.ts `buildCrownGeo`); canopy scale = h / this, so a
 *  tree stands as tall as the surface model measured it. */
export const BASE_TREE_H = 6.4;
/** The generic crown's width at scale 1 (m). */
export const GENERIC_CROWN_W = 5.1;
/**
 * Crown width over tree height where nothing measured the crown: the median
 * of Dresden's surveyed street trees (50 123 with height and crown measured,
 * 0.58 in every 5 m height class from 10 to 30 m). The generic crown alone
 * is 0.8 × its height, and a canopy tree on its 7 m grid drawn that wide
 * stood under five crowns at once.
 */
export const CROWN_TO_HEIGHT = 0.58;
/** A laser-scan crown's width from its measured radius, within these
 *  shares of its height (the radius is the distance to the crown mass's
 *  edge at the peak: of a lone tree its crown, of a group the group's). */
const SCAN_CROWN_TO_HEIGHT: [number, number] = [0.4, 0.75];

/** The horizontal scale that draws the generic crown `width` m across. */
export function crownSpread(width: number): number {
  return width / GENERIC_CROWN_W;
}

/**
 * One tree or hedge segment in the Y-up scene frame. `x` and `z` are the
 * float32 the instance matrix will hold (Math.fround), so the coarse
 * level's file carries them exactly and its crowns hash the same colour
 * jitter.
 */
export interface Placement {
  /** DOP NDVI 0..1 at this point (lush↔dry crown colour); undefined = no raster */
  ndvi?: number;
  rot: number;
  /** the vertical scale (height / BASE_TREE_H) */
  s: number;
  /** the horizontal scale (crown width / GENERIC_CROWN_W); absent = `s` */
  w?: number;
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
      const s = isHedge ? 1 : 0.8 + hash(seed) * 0.6;
      const place: Placement = {
        x: w.x,
        y: ground,
        z: w.z,
        rot: isHedge ? hash(seed) * 0.3 : hash(seed * 1.7) * Math.PI,
        s,
        ...(isHedge
          ? {}
          : { w: crownSpread(s * BASE_TREE_H * CROWN_TO_HEIGHT) }),
        ndvi: ndviAt?.(ex, ey),
      };
      (isHedge ? hedges : trees).push(place);
    }
  }
  return { trees, hedges };
}

/**
 * A canopy tree's crown width (m): from the laser scan's measured radius
 * where the point has one (`r`), else CROWN_TO_HEIGHT of its height; `v`
 * (0..1) varies it by ±10 %.
 */
export function canopyCrownWidth(
  height: number,
  r: number | undefined,
  v: number
): number {
  const jitter = 0.9 + v * 0.2;
  if (r !== undefined && Number.isFinite(r) && r > 0) {
    const [lo, hi] = SCAN_CROWN_TO_HEIGHT;
    return Math.min(Math.max(2 * r, lo * height), hi * height) * jitter;
  }
  return height * CROWN_TO_HEIGHT * jitter;
}

/** Canopy points (DOM1-derived, and the laser scan's with a crown radius)
 *  → tree placements as tall as measured, CROWN_TO_HEIGHT wide or as wide
 *  as the scan measured. */
export function canopyPlacements(
  features: (CanopyFeature & {
    properties: { h: number; r?: number } | null;
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
    // A point missing a numeric `h` (only the TS type, not the JSON, promises
    // one) would make scale NaN; Math.max/min don't clamp NaN, so the NaN
    // matrix poisons the chunk's bounding sphere and the whole cell culls.
    const rawH = f.properties?.h ?? Number.NaN;
    const h = Number.isFinite(rawH) ? rawH : BASE_TREE_H;
    const seed = ex * 0.13 + ey * 0.07;
    const w = worldOf(ex, ey, ctx.offset);
    // Scale the tree to the measured canopy height (± a touch) …
    const s =
      Math.min(Math.max(h / BASE_TREE_H, 0.5), 7) * (0.9 + hash(seed) * 0.2);
    // … and its crown to a measured or a typical width, separately.
    const width = canopyCrownWidth(
      s * BASE_TREE_H,
      f.properties?.r,
      hash(seed * 2.3 + 0.7)
    );
    out.push({
      x: w.x,
      y: ground,
      z: w.z,
      rot: hash(seed * 1.7) * Math.PI,
      s,
      w: crownSpread(width),
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
