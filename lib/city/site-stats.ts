/**
 * A city in numbers, for the start page's orderings ("the greenest centre
 * first"): measured from what the build baked for the site, the same way
 * for every city — the class raster's shares, the tree crowns the surface
 * model shows, LoD2's buildings, the ground's relief. Written by
 * scripts/prepare-data.ts (`site-stats.json`), carried into the index
 * (sites.json) by scripts/prepare-sites.ts. Pure, no DOM.
 */

import type { CityJsonDocument } from "./types";

/** The file prepare-data writes next to the manifest. */
export const SITE_STATS_FILE = "site-stats.json";

export interface SiteStats {
  /** the area the tiles cover (km²) */
  areaKm2: number;
  /** LoD2 buildings per km² */
  buildingsPerKm2: number;
  /** the share of the ground under a building's footprint (0..1) */
  builtShare: number;
  /** tree crowns per km², as the surface model (DOM1) and the laser scan
   *  see them — the same measurement in every city with a surface model */
  crownsPerKm2: number;
  /** the share of forest, copse and farmland/meadow in the land cover */
  greenShare: number;
  /** the site's Wikidata landmarks */
  landmarks: number;
  /** the median LoD2 building's height (m) */
  medianHeightM: number;
  /** the ground's relief: its 90th minus its 2nd height percentile (m) */
  reliefM: number;
  /** the tallest LoD2 building (m) */
  tallestM: number;
  /** the share of water in the land cover */
  waterShare: number;
}

/** The land-cover classes counted as green and as water (lib/city/landcover.ts). */
export const GREEN_CLASSES = [1, 2, 3] as const;
export const WATER_CLASS = 8;

/** Shares of the green and the water classes in a class histogram. */
export function landcoverShares(histogram: readonly number[]): {
  greenShare: number;
  waterShare: number;
} {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { greenShare: 0, waterShare: 0 };
  }
  const green = GREEN_CLASSES.reduce((a, c) => a + (histogram[c] ?? 0), 0);
  return {
    greenShare: green / total,
    waterShare: (histogram[WATER_CLASS] ?? 0) / total,
  };
}

/** The value at quantile `q` (0..1) of `values`; 0 when empty. */
export function quantile(values: readonly number[], q: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) {
    return 0;
  }
  return v[Math.min(v.length - 1, Math.floor(q * v.length))];
}

/** How the start page can order its cities. */
export type SiteOrder =
  | "featured"
  | "crowns"
  | "green"
  | "water"
  | "tall"
  | "dense"
  | "hilly"
  | "landmarks"
  | "large";

export interface SiteOrdering {
  /** the figure a card shows under this ordering, or none */
  figure?: (s: SiteStats) => string;
  id: SiteOrder;
  label: string;
  /** larger first; absent = the featured order */
  value?: (s: SiteStats) => number;
}

const de = (n: number, digits = 0) =>
  n.toLocaleString("de-DE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const percent = (share: number) => `${de(share * 100)} %`;

export const SITE_ORDERINGS: readonly SiteOrdering[] = [
  { id: "featured", label: "Empfohlen" },
  {
    id: "crowns",
    label: "Meiste Bäume",
    value: (s) => s.crownsPerKm2,
    figure: (s) => `${de(s.crownsPerKm2)} Baumkronen je km²`,
  },
  {
    id: "green",
    label: "Am grünsten",
    value: (s) => s.greenShare,
    figure: (s) => `${percent(s.greenShare)} Wald, Wiese und Feld`,
  },
  {
    id: "water",
    label: "Am meisten Wasser",
    value: (s) => s.waterShare,
    figure: (s) => `${percent(s.waterShare)} Wasser`,
  },
  {
    id: "tall",
    label: "Höchste Häuser",
    value: (s) => s.medianHeightM,
    figure: (s) =>
      `Häuser im Mittel ${de(s.medianHeightM, 1)} m, das höchste ${de(s.tallestM)} m`,
  },
  {
    id: "dense",
    label: "Am dichtesten bebaut",
    value: (s) => s.builtShare,
    figure: (s) => `${percent(s.builtShare)} der Fläche bebaut`,
  },
  {
    id: "hilly",
    label: "Am hügeligsten",
    value: (s) => s.reliefM,
    figure: (s) => `${de(s.reliefM)} m Höhenunterschied`,
  },
  {
    id: "landmarks",
    label: "Meiste Wahrzeichen",
    value: (s) => s.landmarks,
    figure: (s) => `${de(s.landmarks)} Wahrzeichen`,
  },
  {
    id: "large",
    label: "Größte Fläche",
    value: (s) => s.areaKm2,
    figure: (s) => `${de(s.areaKm2)} km²`,
  },
];

/** The ordering by id (the featured one for an unknown id). */
export function orderingOf(id: string): SiteOrdering {
  return SITE_ORDERINGS.find((o) => o.id === id) ?? SITE_ORDERINGS[0];
}

/**
 * The cities in an ordering: by its figure, largest first, a city without
 * figures last; the featured order puts `featured` first (the reference
 * site, the best kept) and the rest by name. Ties keep the featured order.
 */
export function orderSites<
  T extends { id: string; name: string; stats?: SiteStats },
>(sites: readonly T[], order: SiteOrder, featured: string): T[] {
  const byFeature = [...sites].sort(
    (a, b) =>
      Number(b.id === featured) - Number(a.id === featured) ||
      a.name.localeCompare(b.name, "de")
  );
  const { value } = orderingOf(order);
  if (!value) {
    return byFeature;
  }
  const v = (s: T) => (s.stats ? value(s.stats) : Number.NEGATIVE_INFINITY);
  return byFeature
    .map((s, i) => ({ s, i }))
    .sort((a, b) => v(b.s) - v(a.s) || a.i - b.i)
    .map(({ s }) => s);
}

/** The stats, or undefined when the value is not a complete record. */
export function parseSiteStats(value: unknown): SiteStats | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const keys: (keyof SiteStats)[] = [
    "areaKm2",
    "buildingsPerKm2",
    "builtShare",
    "crownsPerKm2",
    "greenShare",
    "landmarks",
    "medianHeightM",
    "reliefM",
    "tallestM",
    "waterShare",
  ];
  const record = value as Record<string, unknown>;
  return keys.every(
    (k) => typeof record[k] === "number" && Number.isFinite(record[k])
  )
    ? (value as SiteStats)
    : undefined;
}

/** Every vertex index a CityJSON boundary array holds, however nested. */
function vertexIndices(boundary: unknown, out: number[]): void {
  if (typeof boundary === "number") {
    out.push(boundary);
  } else if (Array.isArray(boundary)) {
    for (const b of boundary) {
      vertexIndices(b, out);
    }
  }
}

/**
 * Each building's height (m): LoD2's `measuredHeight` where it carries one,
 * else the span of its own and its parts' vertices. One per Building, not
 * per part.
 */
export function buildingHeights(doc: CityJsonDocument): number[] {
  const scale = doc.transform?.scale[2] ?? 1;
  const objects = doc.CityObjects;
  const out: number[] = [];
  for (const [id, o] of Object.entries(objects)) {
    if (o.type !== "Building" || (o.parents?.length ?? 0) > 0) {
      continue;
    }
    const measured = o.attributes?.measuredHeight;
    if (typeof measured === "number" && measured > 0) {
      out.push(measured);
      continue;
    }
    const indices: number[] = [];
    for (const oid of [id, ...(o.children ?? [])]) {
      for (const g of objects[oid]?.geometry ?? []) {
        vertexIndices((g as { boundaries?: unknown }).boundaries, indices);
      }
    }
    if (indices.length > 0) {
      const zs = indices.map((i) => doc.vertices[i][2]);
      out.push((Math.max(...zs) - Math.min(...zs)) * scale);
    }
  }
  return out;
}

/** The area (m²) of a footprints file's polygons (cm, per object). */
export function footprintArea(
  footprints: readonly (readonly (readonly [number, number])[][])[]
): number {
  let cm2 = 0;
  for (const polys of footprints) {
    for (const ring of polys) {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % ring.length];
        a += x0 * y1 - x1 * y0;
      }
      cm2 += Math.abs(a) / 2;
    }
  }
  return cm2 / 1e4;
}
