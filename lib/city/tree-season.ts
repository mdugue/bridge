/**
 * The year in the trees: how far a crown is in leaf and how far it has
 * turned, per genus, for a day of the year — Dresden's climate (the
 * Elbe valley: leaf-out mid-April to early May, full leaf to September,
 * colouring in October, leaf fall late October to late November).
 *
 * Pure: no THREE, no DOM. The scene (vegetation-layer.ts) evaluates it per
 * tree on a date change — never per frame — and writes the result into the
 * crowns' per-instance colour and leaf-cover attributes.
 *
 * The dates are typical, rounded values for the common street and park
 * trees in a lowland city climate, in the phases the Deutscher Wetterdienst's
 * phenology uses (Blattentfaltung, Blattverfärbung, Blattfall) — an
 * illustrator's calendar, not a model fitted to observations; the autumn
 * hues are the scene's pastel register, not photographs.
 */

/**
 * The genus table, in the bake's order (pipeline/bake/tree_archetypes.py
 * GENERA, written into every trees_<tile>.geojson as `genera`;
 * features.test.ts checks the committed files against this list). A tree's
 * `gn` indexes it. Append only. 0 is "other deciduous", the generic curve
 * the canopy, the tree rows and any tree without a known genus follow.
 */
export const TREE_GENERA = [
  "",
  "Acer",
  "Acer rubrum",
  "Tilia",
  "Quercus",
  "Quercus rubra",
  "Fraxinus",
  "Aesculus",
  "Prunus",
  "Platanus",
  "Robinia",
  "Carpinus",
  "Crataegus",
  "Gleditsia",
  "Sophora",
  "Ulmus",
  "Betula",
  "Malus",
  "Liquidambar",
  "Populus",
  "Ailanthus",
  "Salix",
  "Alnus",
  "Koelreuteria",
  "Sorbus",
  "Liriodendron",
  "Catalpa",
  "Corylus",
  "Pyrus",
  "Ginkgo",
  "Ostrya",
  "Fagus",
  "Castanea",
  "Juglans",
  "Celtis",
  "Larix",
  "Metasequoia",
  "Taxodium",
] as const;
export type TreeGenus = (typeof TREE_GENERA)[number];

/** A day span [from, to] in days since 1 January (0-based). */
export type DaySpan = readonly [number, number];

/** One genus's year. Spans must not cross New Year and must be ordered:
 *  leafOut ends before fall starts, and colouring starts after leaf-out. */
export interface Phenology {
  /** bare (or the dead leaves held over winter) → full leaf */
  leafOut: DaySpan;
  /** summer green → the autumn hue */
  colour: DaySpan;
  /** full crown → bare (or the held fraction) */
  fall: DaySpan;
  /** the autumn hue: HSL (0..1) in the scene's pastel register */
  hue: readonly [number, number, number];
  /** fraction of the crown that hangs on, dead and coloured, through the
   *  winter (marcescence: oaks, beech and hornbeam) */
  hold?: number;
}

// The hues, named once: several genera share a colour.
const BUTTER: Phenology["hue"] = [0.14, 0.6, 0.66];
const YELLOW: Phenology["hue"] = [0.15, 0.5, 0.63];
const GOLDEN: Phenology["hue"] = [0.13, 0.62, 0.63];
const ORANGE: Phenology["hue"] = [0.1, 0.6, 0.6];
const ORANGE_RED: Phenology["hue"] = [0.045, 0.55, 0.55];
const RED: Phenology["hue"] = [0.0, 0.55, 0.52];
const RUSSET: Phenology["hue"] = [0.07, 0.42, 0.47];
const TAN: Phenology["hue"] = [0.09, 0.38, 0.55];
const RUST: Phenology["hue"] = [0.05, 0.55, 0.49];
const YELLOW_BROWN: Phenology["hue"] = [0.11, 0.45, 0.56];

/**
 * Per genus, in TREE_GENERA order. Dates are 0-based days of a common year
 * (104 = 15 April, 273 = 1 October, 304 = 1 November, 334 = 1 December).
 */
export const PHENOLOGY: Readonly<Record<TreeGenus, Phenology>> = {
  // other deciduous: the generic curve
  "": {
    leafOut: [104, 124],
    colour: [274, 300],
    fall: [296, 326],
    hue: [0.12, 0.45, 0.6],
  },
  Acer: {
    leafOut: [98, 118],
    colour: [280, 300],
    fall: [294, 318],
    hue: ORANGE,
  },
  // A. rubrum, A. × freemanii, 'October Glory', 'Autumn Blaze': deep red
  "Acer rubrum": {
    leafOut: [100, 120],
    colour: [276, 298],
    fall: [296, 322],
    hue: RED,
  },
  // early to turn and to drop
  Tilia: {
    leafOut: [104, 124],
    colour: [266, 286],
    fall: [282, 306],
    hue: BUTTER,
  },
  // late, russet, and young oaks keep dead leaves into spring
  Quercus: {
    leafOut: [114, 134],
    colour: [290, 314],
    fall: [306, 336],
    hue: RUSSET,
    hold: 0.3,
  },
  "Quercus rubra": {
    leafOut: [112, 132],
    colour: [284, 306],
    fall: [300, 326],
    hue: [0.02, 0.5, 0.47],
    hold: 0.15,
  },
  // ash drops its leaves almost green
  Fraxinus: {
    leafOut: [120, 140],
    colour: [280, 294],
    fall: [284, 304],
    hue: [0.18, 0.35, 0.6],
  },
  // the horse-chestnut leaf miner browns the crowns from August
  Aesculus: {
    leafOut: [94, 114],
    colour: [215, 275],
    fall: [268, 298],
    hue: [0.08, 0.35, 0.5],
  },
  Prunus: {
    leafOut: [94, 112],
    colour: [268, 290],
    fall: [284, 306],
    hue: ORANGE_RED,
  },
  // late, tan, the last leaves hang on into December
  Platanus: {
    leafOut: [114, 134],
    colour: [288, 314],
    fall: [300, 340],
    hue: TAN,
  },
  Robinia: {
    leafOut: [124, 144],
    colour: [280, 298],
    fall: [288, 310],
    hue: YELLOW,
  },
  Carpinus: {
    leafOut: [104, 122],
    colour: [284, 304],
    fall: [298, 326],
    hue: YELLOW_BROWN,
    hold: 0.15,
  },
  Crataegus: {
    leafOut: [98, 116],
    colour: [278, 298],
    fall: [292, 314],
    hue: ORANGE_RED,
  },
  Gleditsia: {
    leafOut: [124, 144],
    colour: [272, 288],
    fall: [282, 300],
    hue: GOLDEN,
  },
  Sophora: {
    leafOut: [124, 144],
    colour: [288, 304],
    fall: [294, 318],
    hue: YELLOW,
  },
  Ulmus: {
    leafOut: [100, 120],
    colour: [280, 300],
    fall: [290, 314],
    hue: YELLOW,
  },
  // golden and early
  Betula: {
    leafOut: [100, 118],
    colour: [268, 290],
    fall: [284, 308],
    hue: GOLDEN,
  },
  Malus: {
    leafOut: [100, 118],
    colour: [280, 300],
    fall: [294, 316],
    hue: ORANGE,
  },
  Liquidambar: {
    leafOut: [110, 130],
    colour: [288, 312],
    fall: [306, 334],
    hue: [0.97, 0.5, 0.46],
  },
  Populus: {
    leafOut: [100, 118],
    colour: [276, 296],
    fall: [286, 310],
    hue: BUTTER,
  },
  Ailanthus: {
    leafOut: [120, 140],
    colour: [276, 292],
    fall: [284, 302],
    hue: YELLOW,
  },
  Salix: {
    leafOut: [90, 110],
    colour: [290, 310],
    fall: [300, 330],
    hue: YELLOW,
  },
  // alder falls green
  Alnus: {
    leafOut: [100, 118],
    colour: [292, 310],
    fall: [296, 320],
    hue: [0.2, 0.25, 0.5],
  },
  Koelreuteria: {
    leafOut: [112, 132],
    colour: [280, 298],
    fall: [292, 312],
    hue: ORANGE,
  },
  Sorbus: {
    leafOut: [98, 116],
    colour: [262, 284],
    fall: [280, 302],
    hue: ORANGE_RED,
  },
  Liriodendron: {
    leafOut: [108, 128],
    colour: [276, 296],
    fall: [290, 312],
    hue: GOLDEN,
  },
  Catalpa: {
    leafOut: [130, 150],
    colour: [284, 300],
    fall: [288, 306],
    hue: YELLOW_BROWN,
  },
  Corylus: {
    leafOut: [96, 114],
    colour: [280, 300],
    fall: [292, 314],
    hue: YELLOW,
  },
  // the street pears (P. calleryana) turn wine red
  Pyrus: {
    leafOut: [98, 116],
    colour: [288, 312],
    fall: [302, 326],
    hue: [0.99, 0.45, 0.5],
  },
  // pure yellow, and bare within days
  Ginkgo: {
    leafOut: [106, 126],
    colour: [292, 310],
    fall: [314, 320],
    hue: [0.15, 0.75, 0.62],
  },
  Ostrya: {
    leafOut: [104, 122],
    colour: [282, 302],
    fall: [294, 318],
    hue: YELLOW,
  },
  Fagus: {
    leafOut: [108, 126],
    colour: [284, 304],
    fall: [298, 322],
    hue: [0.07, 0.55, 0.5],
    hold: 0.15,
  },
  Castanea: {
    leafOut: [110, 130],
    colour: [284, 304],
    fall: [296, 318],
    hue: YELLOW_BROWN,
  },
  Juglans: {
    leafOut: [122, 140],
    colour: [272, 290],
    fall: [280, 298],
    hue: YELLOW,
  },
  Celtis: {
    leafOut: [110, 130],
    colour: [282, 300],
    fall: [292, 314],
    hue: YELLOW,
  },
  // the deciduous conifers: rust, then bare
  Larix: {
    leafOut: [94, 114],
    colour: [292, 314],
    fall: [308, 334],
    hue: [0.09, 0.62, 0.55],
  },
  Metasequoia: {
    leafOut: [112, 132],
    colour: [294, 318],
    fall: [310, 336],
    hue: RUST,
  },
  Taxodium: {
    leafOut: [114, 134],
    colour: [294, 318],
    fall: [312, 338],
    hue: RUST,
  },
};

/** How far a crown is in leaf (1 full, 0 bare) and turned (0 summer green,
 *  1 the full autumn hue). */
export interface Season {
  autumn: number;
  leaf: number;
}

/** An evergreen's every day. */
export const EVERGREEN: Readonly<Season> = { leaf: 1, autumn: 0 };

/** Largest per-tree offset (days) of the phenology: a street turns over
 *  about a week and a half, not in one night. */
export const SEASON_JITTER_DAYS = 6;

const YEAR = 365;

/** The phenology of a `gn` (an out-of-table index is the generic curve). */
export function phenologyOf(genus: number): Phenology {
  return PHENOLOGY[TREE_GENERA[genus] ?? ""];
}

/** Days since 1 January (0-based, fractional), UTC; a 29 February folds
 *  into 28 February's day so the table stays a common year's. */
export function dayOfYear(date: Date): number {
  const t = date.getTime();
  const year = date.getUTCFullYear();
  const day = (t - Date.UTC(year, 0, 1)) / 86_400_000;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap && day >= 59 ? Math.max(day - 1, 58) : day;
}

/** A tree's phenology offset (days, ±SEASON_JITTER_DAYS) from a stable
 *  [0, 1) hash of it. */
export function seasonJitter(u: number): number {
  return (u - 0.5) * 2 * SEASON_JITTER_DAYS;
}

function ramp([a, b]: DaySpan, d: number): number {
  const t = Math.min(Math.max((d - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The crown of a deciduous tree of `genus` (a TREE_GENERA index) on `day`
 * (days since 1 January), shifted by the tree's own `jitter` (days; a
 * positive jitter is a late tree). Leaf rises through leaf-out, holds, and
 * falls through leaf fall to the held fraction; autumn rises through the
 * colouring, stays through the winter (only held leaves show it) and fades
 * again while the new leaves come.
 */
export function seasonAt(day: number, genus: number, jitter = 0): Season {
  const p = phenologyOf(genus);
  const d = (((day - jitter) % YEAR) + YEAR) % YEAR;
  const hold = p.hold ?? 0;
  const up = ramp(p.leafOut, d);
  const leaf =
    d < p.fall[0] ? hold + (1 - hold) * up : 1 - (1 - hold) * ramp(p.fall, d);
  const autumn = d < p.leafOut[1] ? 1 - up : ramp(p.colour, d);
  return { leaf, autumn };
}
