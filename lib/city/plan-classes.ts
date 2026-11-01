/**
 * What a landscape plan's surfaces are (ADR 0054): a plan comes as layers
 * (DXF), as attributes (Shapefile, GeoPackage) or as a file name, and an
 * office names them its own way — "Rasen", "L-PFLASTER", "Wassergebunde
 * Wegedecke", "lawn". The class is read from those names by keywords,
 * German and English; what no keyword names stays a plain surface in the
 * file's grey. Each class has a look from the city's one palette
 * (landcover.ts), so a plan sits in the city like its own ground. No
 * THREE, no DOM.
 */

import { LANDCOVER_CLASSES } from "./landcover";

export type PlanClass =
  | "lawn"
  | "planting"
  | "wood"
  | "paving"
  | "path"
  | "road"
  | "water"
  | "sand"
  | "gravel"
  | "building"
  | "tree"
  | "terrain";

/** Keywords per class, matched against the lower-cased name; the first
 *  class whose pattern matches wins, so the narrower ones come first. */
const KEYWORDS: readonly [PlanClass, RegExp][] = [
  // (not "street": "tree" only where no letter comes before it)
  [
    "tree",
    /baum|bäume|baeume|(?<![a-z])trees?|gehölz.?punkt|solitär|solitaer|krone/,
  ],
  ["gravel", /kies|schotter|splitt|wassergeb|gravel|grus|tenne|chaussierung/],
  ["water", /wasser|teich|becken|bach|fluss|pool|pond|water|brunnen|rinne/],
  ["sand", /sand|spielplatz|spielfl|play|fallschutz/],
  [
    "road",
    /fahrbahn|straße|strasse|street|asphalt|road|parkpl|stellpl|zufahrt/,
  ],
  ["path", /weg|pfad|path|walk|fußweg|fussweg|gehweg|radweg/],
  [
    "paving",
    /pflaster|platte|platz|belag|paving|plaza|beton|naturstein|terrass|hof/,
  ],
  ["wood", /wald|forest|woodland|baumhain|hain/],
  [
    "planting",
    /beet|pflanz|staude|strauch|sträucher|hecke|gebüsch|gebuesch|shrub|planting|bodendecker|gräser|graeser/,
  ],
  ["lawn", /rasen|wiese|grün|gruen|lawn|grass|meadow|green|vegetation/],
  ["building", /gebäude|gebaeude|haus|building|bau(körper|koerper)|hochbau/],
  ["terrain", /gelände|gelaende|dgm|terrain|surface|tin|höhen|hoehen/],
];

/** The class a name speaks of, or null. */
export function planClass(name: string | null | undefined): PlanClass | null {
  if (!name) {
    return null;
  }
  const lower = name.toLowerCase();
  for (const [cls, pattern] of KEYWORDS) {
    if (pattern.test(lower)) {
      return cls;
    }
  }
  return null;
}

/** The class of the first of `names` that speaks of one, or null. */
export function planClassOf(
  names: readonly (string | null | undefined)[]
): PlanClass | null {
  for (const name of names) {
    const cls = planClass(name);
    if (cls) {
      return cls;
    }
  }
  return null;
}

const palette = (key: string) =>
  LANDCOVER_CLASSES.find((c) => c.key === key)?.srgb ?? [220, 220, 220];

/** A class's colour (sRGB 0..255) — the palette's where the city has the
 *  same ground — and how far it lies above the ground (m): a few
 *  centimetres, the beds and lawns a little above the hard surfaces they
 *  meet; what an area is drawn into it lies above in any case
 *  (plan-geometry.ts `nestingDepth`). */
/** What a plan's triangles are drawn as: a class, a surface no name
 *  told, or a tree's trunk. */
export type PlanLook = PlanClass | "other" | "trunk";

export const PLAN_LOOKS: Readonly<
  Record<PlanLook, { srgb: readonly [number, number, number]; lift: number }>
> = {
  terrain: { srgb: palette("background"), lift: 0 },
  road: { srgb: palette("road"), lift: 0.02 },
  paving: { srgb: [214, 208, 198], lift: 0.025 },
  path: { srgb: palette("path"), lift: 0.025 },
  gravel: { srgb: [206, 196, 178], lift: 0.025 },
  sand: { srgb: [232, 218, 184], lift: 0.03 },
  lawn: { srgb: palette("farmland"), lift: 0.03 },
  wood: { srgb: palette("forest"), lift: 0.035 },
  planting: { srgb: palette("copse"), lift: 0.035 },
  water: { srgb: palette("water"), lift: 0.02 },
  building: { srgb: [240, 238, 234], lift: 0 },
  tree: { srgb: palette("forest"), lift: 0 },
  other: { srgb: [222, 220, 214], lift: 0.025 },
  trunk: { srgb: [134, 120, 104], lift: 0 },
};
