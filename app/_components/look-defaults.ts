import type { LookPct } from "@/lib/city/look-controls";
import { DEFAULT_ATMOSPHERE } from "./create-app";
import { DEFAULT_HEIGHT_FOG } from "./height-fog";
import {
  DEFAULT_CONTACT_SHADOWS,
  DEFAULT_DEPTH_GRADING,
  DEFAULT_PAPER_GRAIN,
} from "./post-stack";
import { DEFAULT_MEADOW_NDVI } from "./terrain-layer";
import {
  DEFAULT_TREE_LEAF_BRIGHT,
  DEFAULT_TREE_LEAF_FLUTTER,
  DEFAULT_TREE_SHIMMER,
  DEFAULT_TREE_TRANSLUCENCY,
} from "./vegetation-layer";
import {
  DEFAULT_BUILDING_BANDS,
  DEFAULT_BUILDING_DUSK_GLOW,
  DEFAULT_BUILDING_EAVE,
  DEFAULT_BUILDING_GROUND_SHADE,
  DEFAULT_BUILDING_RIM,
  DEFAULT_BUILDING_ROOF_TINT,
  DEFAULT_BUILDING_ROOF_VIBRANCE,
  DEFAULT_BUILDING_ROUGHNESS,
  DEFAULT_BUILDING_TINT,
  DEFAULT_CLAY_TRANSPARENCY,
} from "./visual-style";
import { DEFAULT_WATER_MIST } from "./water-layer";

const pct = (v: number) => Math.round(v * 100);

/** Initial percent value of every look slider — mirrors the scene's own defaults. */
export const DEFAULT_LOOK_PCT: LookPct = {
  fogAmount: pct(DEFAULT_ATMOSPHERE),
  heightFog: pct(DEFAULT_HEIGHT_FOG),
  waterMist: pct(DEFAULT_WATER_MIST),
  grading: pct(DEFAULT_DEPTH_GRADING),
  transparency: pct(DEFAULT_CLAY_TRANSPARENCY),
  groundShade: pct(DEFAULT_BUILDING_GROUND_SHADE),
  bands: pct(DEFAULT_BUILDING_BANDS),
  rim: pct(DEFAULT_BUILDING_RIM),
  tint: pct(DEFAULT_BUILDING_TINT),
  roofTint: pct(DEFAULT_BUILDING_ROOF_TINT),
  roofVibrance: pct(DEFAULT_BUILDING_ROOF_VIBRANCE),
  eave: pct(DEFAULT_BUILDING_EAVE),
  duskGlow: pct(DEFAULT_BUILDING_DUSK_GLOW),
  roughness: pct(DEFAULT_BUILDING_ROUGHNESS),
  meadowNdvi: pct(DEFAULT_MEADOW_NDVI),
  shimmer: pct(DEFAULT_TREE_SHIMMER),
  translucency: pct(DEFAULT_TREE_TRANSLUCENCY),
  leafFlutter: pct(DEFAULT_TREE_LEAF_FLUTTER),
  leafBright: pct(DEFAULT_TREE_LEAF_BRIGHT),
  contact: pct(DEFAULT_CONTACT_SHADOWS),
  grain: pct(DEFAULT_PAPER_GRAIN),
};
