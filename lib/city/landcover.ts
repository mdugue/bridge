/**
 * The land-cover classes and the ONE palette that paints them. The DLM bake
 * (pipeline/bake/landcover.py) writes only class ids; every consumer colours
 * them from this table at runtime — the terrain (a GPU pass,
 * app/_components/landcover-splat.ts), the minimap and the /wissen picture
 * (scripts/bake-wissen-hero.ts). Changing a colour here is a look change,
 * not a re-bake. No THREE, no DOM.
 */

export interface LandcoverClass {
  id: number;
  key: string;
  /** pastel tint, sRGB 0..255 */
  srgb: readonly [number, number, number];
}

/**
 * Curated pastel earth tones (high value, low saturation, analogous). The ids
 * are the ones the DLM bake burns, lowest priority first — water always wins.
 */
export const LANDCOVER_CLASSES: readonly LandcoverClass[] = [
  { id: 0, key: "background", srgb: [230, 224, 209] }, // warm pale taupe
  { id: 1, key: "farmland", srgb: [197, 211, 170] }, // soft sage
  { id: 2, key: "forest", srgb: [150, 176, 138] }, // muted moss
  { id: 3, key: "copse", srgb: [175, 195, 158] }, // light moss
  { id: 4, key: "builtup", srgb: [228, 219, 203] }, // warm pale clay
  { id: 5, key: "railway", srgb: [178, 169, 160] }, // warm ballast grey
  { id: 6, key: "path", srgb: [224, 205, 168] }, // pale warm sand
  { id: 7, key: "road", srgb: [200, 200, 206] }, // soft grey-lavender
  { id: 8, key: "water", srgb: [164, 192, 209] }, // dusty blue
];

export const WATER_CLASS = 8;
export const MEADOW_CLASS = 1;

/** sRGB tint of a class id; unknown ids take the background tint. */
export function landcoverSrgb(id: number): readonly [number, number, number] {
  return (LANDCOVER_CLASSES[id] ?? LANDCOVER_CLASSES[0]).srgb;
}

/** One sRGB byte (0..255) to linear light (0..1), the IEC 61966-2-1 curve. */
export function srgbToLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The palette as linear RGB triples, flattened in id order — the layout the
 * terrain's `vec3[]` uniform takes.
 */
export function linearPalette(): number[] {
  return LANDCOVER_CLASSES.flatMap(({ srgb }) => srgb.map(srgbToLinear));
}
