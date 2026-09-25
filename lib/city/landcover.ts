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
export const BUILTUP_CLASS = 4;
export const PATH_CLASS = 6;
export const ROAD_CLASS = 7;

/**
 * The paving materials of the OSM surface raster (pipeline/bake/surface.py
 * `SURFACES`; the ids are its bytes): which pattern the terrain shader draws
 * on a street or a walkway. 0 = unknown — the shader falls back to the land-
 * cover class (asphalt on the carriageway, slabs on the pavement, a sanded
 * path on class 6).
 */
export const SURFACE_KINDS = [
  "unknown",
  "asphalt",
  "concrete",
  "paving",
  "sett",
  "unpaved",
  "grass",
] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

/** A surface kind's id (its index), for the shader's constants. */
export function surfaceId(kind: SurfaceKind): number {
  return SURFACE_KINDS.indexOf(kind);
}

/**
 * Bytes per metre of the edge-distance raster (pipeline/bake/edges.py
 * `EDGE_SCALE`, its legend's `scale`): a byte is 128 + scale · the signed
 * distance to the road or the meadow edge.
 */
export const EDGE_SCALE = 20;

/**
 * The period (m) the paving raster stores the along-street coordinate
 * modulo (pipeline/bake/surface.py `ALONG_PERIOD`, and its legend's
 * `alongPeriod`); every pattern length along a street must divide it.
 */
export const SURFACE_ALONG_PERIOD = 165;

/**
 * Where cars park, the raster's top two bits (pipeline/bake/surface.py
 * `PARKING`): a parking lane beside the carriageway with parallel or
 * perpendicular/diagonal bays (laid out from the kerb), or a car park (bay
 * lines across its direction, its aisles left clear).
 */
export const PARKING_KINDS = [
  "none",
  "street-parallel",
  "street-perpendicular",
  "lot",
] as const;
export type ParkingKind = (typeof PARKING_KINDS)[number];

/** A parking kind's id (its index), for the shader's constants. */
export function parkingId(kind: ParkingKind): number {
  return PARKING_KINDS.indexOf(kind);
}

/**
 * What one texel of the raster packs (`R = park * 64 + walk * 8 + road`):
 * the carriageway's and the pavement's material (each 0..7) and the parking
 * kind (0..3).
 */
export function unpackSurface(byte: number): {
  park: number;
  road: number;
  walk: number;
} {
  return { road: byte & 7, walk: (byte >> 3) & 7, park: byte >> 6 };
}

/**
 * The street direction the raster's G channel stores (0 = unknown, else
 * 1 + bearing mod 180° over 0..254) in radians from east, or null.
 */
export function surfaceHeading(byte: number): number | null {
  return byte === 0 ? null : ((byte - 1) / 254) * Math.PI;
}

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
