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
 * hues are the scene's pastel register, not photographs. Where DWD's
 * observers around Dresden disagreed by weeks the date follows them (the
 * birch). Another city's year is Dresden's shifted by its climate
 * (SITE_SEASON, `climateDay`).
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
  /** the flowering, for the trees that a street notices in flower: its
   *  span, the blossom's colour (HSL, the scene's pastel register) and how
   *  much of the crown it covers at its peak (0..1) */
  bloom?: Bloom;
}

/** A genus's flowering (Phenology.bloom). */
export interface Bloom {
  colour: readonly [number, number, number];
  span: DaySpan;
  strength: number;
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
    bloom: { span: [118, 138], colour: [0.1, 0.2, 0.93], strength: 0.35 },
  },
  Prunus: {
    leafOut: [94, 112],
    colour: [268, 290],
    fall: [284, 306],
    hue: ORANGE_RED,
    bloom: { span: [92, 116], colour: [0.95, 0.5, 0.86], strength: 0.85 },
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
    bloom: { span: [144, 162], colour: [0.14, 0.3, 0.9], strength: 0.45 },
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
    bloom: { span: [128, 148], colour: [0.1, 0.25, 0.92], strength: 0.7 },
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
  // golden; it turns and drops when the beech does: DWD's reporters
  // around Dresden saw it colour on day 284 and lose half its leaves on 304
  // (2010–2023) — the table had it 16 and 20 days early
  Betula: {
    leafOut: [100, 118],
    colour: [284, 306],
    fall: [300, 324],
    hue: GOLDEN,
  },
  Malus: {
    leafOut: [100, 118],
    colour: [280, 300],
    fall: [294, 316],
    hue: ORANGE,
    bloom: { span: [112, 132], colour: [0.96, 0.42, 0.88], strength: 0.75 },
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
    bloom: { span: [130, 146], colour: [0.13, 0.35, 0.88], strength: 0.45 },
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
    bloom: { span: [176, 196], colour: [0.12, 0.2, 0.93], strength: 0.4 },
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
    bloom: { span: [100, 120], colour: [0.12, 0.25, 0.93], strength: 0.8 },
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

/** A city's climate against Dresden's, the table's: how many days later (+)
 *  or earlier (−) its spring (leaf-out and flowering) and its autumn
 *  (colouring and leaf fall) come. */
export interface SeasonShift {
  autumn: number;
  spring: number;
}

/**
 * Per site id (sites/index.ts; tree-season.test.ts holds every site to an
 * entry): the median, over the species DWD observes, of the difference
 * between the city's and Dresden's median day of each phase — spring the
 * leaf-out and flowering (phases 4, 5), autumn the colouring and leaf fall
 * (31, 32) — from the Deutscher Wetterdienst's annual phenology reporters
 * (opendata.dwd.de climate_environment/CDC/observations_germany/phenology/
 * annual_reporters/wild, 2010–2023; dl-de/by-2-0, "Quelle: Deutscher
 * Wetterdienst") within 30 km of the city and 150 m of its height:
 * twelve trees and shrubs, 39–71 stations a city. Rounded half up; the
 * colouring alone came later still in Hamburg (+10) and München (+4) —
 * one autumn shift splits it with the leaf fall (+1, +2).
 */
export const SITE_SEASON: Readonly<Record<string, SeasonShift>> = {
  berlin: { spring: 0, autumn: -3 },
  dresden: { spring: 0, autumn: 0 },
  grimma: { spring: 0, autumn: -1 },
  hamburg: { spring: 3, autumn: 5 },
  leipzig: { spring: -1, autumn: 1 },
  meissen: { spring: 1, autumn: 1 },
  muenchen: { spring: 2, autumn: 4 },
  unna: { spring: -6, autumn: 1 },
};

/** The site's shift (none for an id the table lacks: Dresden's year). */
export function seasonShiftFor(site: string): SeasonShift {
  return SITE_SEASON[site] ?? { spring: 0, autumn: 0 };
}

// The shift's knots (0-based days): the spring one holds from March to
// June, the autumn one from August through November; between them it
// runs over linearly — in July, and through the bare winter.
const SPRING_FROM = 59;
const SPRING_TO = 181;
const AUTUMN_FROM = 212;
const AUTUMN_TO = 334;

/**
 * The day of Dresden's year (the table's) that looks like `day` in a city
 * of `shift`: its spring `shift.spring` days later is Dresden's spring
 * now, and so its autumn. Monotone (between its knots the shift changes
 * by under a day in three), so the trees still run through the year in
 * order.
 */
export function climateDay(day: number, shift: SeasonShift): number {
  const d = ((day % YEAR) + YEAR) % YEAR;
  const { spring, autumn } = shift;
  let s: number;
  if (d < SPRING_FROM) {
    // the winter half past New Year
    const t = (d + YEAR - AUTUMN_TO) / (SPRING_FROM + YEAR - AUTUMN_TO);
    s = autumn + (spring - autumn) * t;
  } else if (d <= SPRING_TO) {
    s = spring;
  } else if (d < AUTUMN_FROM) {
    s =
      spring +
      ((autumn - spring) * (d - SPRING_TO)) / (AUTUMN_FROM - SPRING_TO);
  } else if (d <= AUTUMN_TO) {
    s = autumn;
  } else {
    const t = (d - AUTUMN_TO) / (SPRING_FROM + YEAR - AUTUMN_TO);
    s = autumn + (spring - autumn) * t;
  }
  return (((d - s) % YEAR) + YEAR) % YEAR;
}

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

/**
 * Days since 1 January (0-based, fractional) on the local calendar — the
 * one the HUD composes the scene date in (city-walk.tsx), so a scrub
 * through the time of day never crosses into another day of the year. Read
 * from the wall-clock fields, so a daylight-saving switch shifts nothing.
 * A 29 February folds into 28 February's day so the table stays a common
 * year's.
 */
export function dayOfYear(date: Date): number {
  const year = date.getFullYear();
  const wall = Date.UTC(
    year,
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
  const day = (wall - Date.UTC(year, 0, 1)) / 86_400_000;
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

/**
 * How far a tree of `genus` is in flower on `day` (0 none … the genus's
 * `strength` at the peak), shifted by its `jitter` like seasonAt: it rises
 * through the first half of the span and fades through the second.
 */
export function bloomAt(day: number, genus: number, jitter = 0): number {
  const b = phenologyOf(genus).bloom;
  if (!b) {
    return 0;
  }
  const d = (((day - jitter) % YEAR) + YEAR) % YEAR;
  const [a, z] = b.span;
  const mid = (a + z) / 2;
  const t = d < mid ? ramp([a, mid], d) : 1 - ramp([mid, z], d);
  return b.strength * t;
}
