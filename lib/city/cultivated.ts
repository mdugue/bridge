/**
 * Cultivated land (pipeline/bake/cultivated.py, plan 028): allotment
 * colonies painted as garden beds in the terrain's fragment pass, orchard
 * trees handed to the tree layer, vine rows as low instanced hedges
 * (app/_components/cultivated-layer.ts). No THREE, no DOM.
 */
import type { CultivatedFeature, TreeFeature } from "./features";
import { TREE_ARCHETYPES } from "./tree-inventory";

/** The colony raster's R byte: 0 none, 1..127 a colony (1 + its long axis
 *  over 0–180° in 0..126), 128..255 a mapped parcel (128 + its axis). */
export const COLONY_AXIS_STEPS = 126;
export const PARCEL_BASE = 128;

/** Decodes the R byte: null outside, else the axis (radians from east) and
 *  whether the texel lies in a mapped parcel. */
export function colonyTexel(
  code: number
): { axis: number; parcel: boolean } | null {
  if (code <= 0) {
    return null;
  }
  const parcel = code >= PARCEL_BASE;
  const step = parcel ? code - PARCEL_BASE : code - 1;
  return { axis: (step / COLONY_AXIS_STEPS) * Math.PI, parcel };
}

/**
 * The bed texture's measures (the shader's constants): beds 1.2 m wide,
 * oriented per ≈12 m plot — a jittered Voronoi cell, so the plots are
 * irregular like a real colony's, not a chessboard — along the colony's
 * long axis or across it. `strength` is the texture's mix at full
 * *Bodendetail*: kept low (plan 028's STOP) because no colony in the four
 * tiles has mapped parcels, so every plot is invented shape, not data.
 */
export const COLONY_BEDS = {
  bedWidth: 1.2,
  plot: 12,
  plotJitter: 0.7,
  strength: 0.45,
} as const;

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
