/**
 * Cultivated land (pipeline/bake/cultivated.py, plan 028): allotment
 * colonies painted as gardens in the terrain's fragment pass, orchard
 * trees handed to the tree layer, vine rows as low instanced hedges
 * (app/_components/cultivated-layer.ts). No THREE, no DOM.
 */
import type { CultivatedFeature, TreeFeature } from "./features";
import { TREE_ARCHETYPES } from "./tree-inventory";

/** The colony raster's G byte: 0 none, else 1 + the colony's (or a mapped
 *  parcel's) long axis over 0–180° in 0..126. */
export const COLONY_AXIS_STEPS = 126;
/** R: 128 + this many bytes per metre of the signed distance to the garden
 *  land's edge (positive inside), 1..255; 0 farther outside. */
export const COLONY_EDGE_SCALE = 20;

/** Decodes the R byte: metres to the garden land's edge (+ inside), or
 *  null where it is farther outside than the byte holds. */
export function colonyEdgeMetres(code: number): number | null {
  return code <= 0 ? null : (code - 128) / COLONY_EDGE_SCALE;
}

/** Decodes the G byte: the axis (radians from east), null where none. */
export function colonyAxis(code: number): number | null {
  return code <= 0 ? null : ((code - 1) / COLONY_AXIS_STEPS) * Math.PI;
}

/**
 * The garden texture's measures (the shader's constants). Plots are the
 * cells of a jittered Voronoi in the colony's axis frame, ≈12 m along its
 * long axis by 17 m across (≈200 m², a *Kleingarten* parcel), their borders
 * meandering (a domain warp of `warp` m) and drawn as thin soft paths; a plot is a lawn in one of a
 * few soft greens, some with warm vegetable beds, some with flower dots.
 * `strength` is the texture's mix at full *Bodendetail*; no colony in the
 * four tiles maps its parcels, so every plot is invented shape and the
 * contrasts stay low.
 */
export const COLONY_GARDEN = {
  bedWidth: 1.1,
  flowerRadius: 0.2,
  flowerSpacing: 1.5,
  jitter: 0.55,
  pathHalfWidth: 0.28,
  plotAcross: 17,
  plotAlong: 12,
  strength: 0.85,
  warp: 2.2,
} as const;

/**
 * The shader's `uCultivatedRect` for a raster prepare-data cropped: the
 * crop's origin and size as fractions of the tile (u east, v south), from
 * `[x, y, width, height, size]` in texels of the full `size`² raster. No
 * crop → the whole tile.
 */
export function colonyCropUv(
  crop?: readonly [number, number, number, number, number]
): [number, number, number, number] {
  if (!crop) {
    return [0, 0, 1, 1];
  }
  const [x, y, w, h, n] = crop;
  return [x / n, y / n, w / n, h / n];
}

/** The orchard trees as the tree layer's cadastre features (the "small"
 *  archetype: a round crown on a ≈1.3 m stem), deciduous. */
export function orchardTrees(features: CultivatedFeature[]): TreeFeature[] {
  const small = TREE_ARCHETYPES.indexOf("small");
  const out: TreeFeature[] = [];
  for (const f of features) {
    if (f.properties?.k !== "tree" || f.geometry?.type !== "Point") {
      continue;
    }
    const { h, d } = f.properties;
    out.push({
      geometry: f.geometry,
      properties: { a: small, h: h ?? 4.5, d: d ?? 4, l: "d" },
    });
  }
  return out;
}

/** The vine rows (LineStrings) of a tile's cultivated features. */
export function vineRows(features: CultivatedFeature[]): [number, number][][] {
  const out: [number, number][][] = [];
  for (const f of features) {
    if (f.properties?.k === "row" && f.geometry?.type === "LineString") {
      out.push(f.geometry.coordinates);
    }
  }
  return out;
}

/** A vine row's canopy: 1.3 m tall, 0.5 m wide (plan 028). */
export const VINE_ROW = { h: 1.3, w: 0.5 } as const;
