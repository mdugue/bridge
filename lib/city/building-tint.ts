import { clamp01 } from "./math";
/**
 * Per-building clay tint — pure, DOM/three-free so it unit-tests under `bun test`
 * and runs in the offline annotate step.
 *
 * The default clay material paints every building the same flat colour, so a
 * dense old-town block reads as one uniform mass. This derives a *stable* tint
 * per building and the clay shader blends it into the base colour (at a fixed
 * strength — `TINT` in visual-style). Two signals drive it:
 *
 *  1. A deterministic hash of the building id — the primary source of variation.
 *     86 % of the buildings carry the unspecified `function` code `31001_9998`,
 *     so semantics alone would leave almost everything identical; the hash gives
 *     each building a stable, well-spread place in its palette family instead.
 *  2. The ALKIS `function` code picks the palette *family* (warm render for
 *     housing, neutral greige for commerce, cool stone for civic/special), and
 *     `measuredHeight` nudges warm→cool with height (tall = stonier). Both are
 *     gentle: the families overlap so neighbours never clash.
 *
 * Every swatch is a muted, high-value earth tone (a variation *of* the clay), so
 * the result stays inside the watercolour art direction even at full strength —
 * it breaks the monolithic massing without reading as a photo-textured city.
 *
 * Returns LINEAR RGB in [0,1]: three converts material colours sRGB→linear, so
 * the shader mixes `diffuseColor` (already linear) against this directly.
 */

export type TintRgb = [number, number, number];

/**
 * What the walls around a building are mostly made of, as its OSM
 * neighbourhood is mapped (pipeline/bake/osm_buildings.py `context`):
 * rendered plaster — the default, Dresden and most southern and central old
 * towns — or brick (Hamburg's Speicherstadt, the northern clinker quarters).
 * It swaps the palette of housing, commerce and civic buildings for one
 * without a mapped material of its own — a brick quarter's schools,
 * offices and warehouses are brick too (Hamburg's: the Kaispeicher, the
 * schools of the clinker quarters). Structures that are no building
 * (non-`31001`: tanks, canopies, towers) keep their cool stone.
 */
export type FacadeMaterial = "brick" | "render";

/** Muted clay-family swatches (sRGB 0..255), grouped by building use. Families
 *  overlap at the edges so the warm/neutral/cool transition is never abrupt.
 *  (Stored as channel tuples, not hex, to keep the module free of bitwise ops.) */
const FAMILIES = {
  // Housing — warm renders: sand, ochre, soft terracotta, warm taupe.
  warm: [
    [233, 222, 201],
    [229, 214, 184],
    [224, 199, 180],
    [222, 211, 196],
  ],
  // Commerce/industry — neutral greige + pale sage.
  neutral: [
    [222, 211, 196],
    [217, 213, 204],
    [210, 214, 196],
  ],
  // Civic / special structures — cooler stone + pale slate.
  cool: [
    [217, 213, 204],
    [207, 210, 206],
    [199, 205, 210],
  ],
  // Brick cities — the clinker of the Kontorhäuser and the Speicherstadt,
  // from orange brick to dark red-brown, plus one pale render for the white
  // stucco between them. The swatches are strong on purpose: at the default
  // mix (60 % into the pale clay, in linear light) they land on a washed,
  // dusty brick (≈ sRGB 182–218, 157–170, 150–155), rosier and darker than
  // the plaster families, and still inside the watercolour register.
  brick: [
    [190, 78, 42],
    [150, 52, 36],
    [204, 104, 62],
    [130, 50, 40],
    [229, 214, 184],
  ],
} as const;

type FamilyKey = keyof typeof FAMILIES;

/** Height (m) at which the warm→cool shift starts and saturates. */
const COOL_START_M = 6;
const COOL_END_M = 30;
/** Max channel push of the height-driven warm/cool shift (sRGB units). */
const COOL_SHIFT = 0.05;
/** Max per-building lightness jitter (sRGB units), from a decorrelated hash. */
const LIGHT_JITTER = 0.03;

/**
 * Deterministic, well-spread string hash → float in [0,1), with no bitwise ops.
 * A polynomial roll in a 31-bit ring gives a distinct,
 * decorrelated seed per id; a sine-fract scramble breaks any residual ordering.
 */
const HASH_MOD = 2_147_483_647; // 2^31 − 1 (Mersenne prime)
function hash01(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % HASH_MOD;
  }
  const x = Math.sin((h / HASH_MOD) * 127.1 + 311.7) * 43_758.5453;
  return x - Math.floor(x);
}

/** ALKIS Gebäudefunktion code → palette family. `31001_2xxx` = commerce,
 *  `31001_3xxx` = public, non-`31001` majors = special structures; the dominant
 *  `9998`/`1xxx` (and anything unknown) read as housing. */
function familyOf(fn: string | undefined): FamilyKey {
  if (!fn) {
    return "warm";
  }
  const [major, minor = ""] = fn.split("_");
  if (major !== "31001") {
    return "cool";
  }
  if (minor.startsWith("2")) {
    return "neutral";
  }
  if (minor.startsWith("3")) {
    return "cool";
  }
  return "warm";
}

function srgbChannelToLinear(c: number): number {
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** What OSM says a building looks like (osm_buildings.py via
 *  lib/city/city-mesh.ts `inheritedLook`). */
export interface OsmLook {
  /** walls, `#rrggbb` */
  colour?: string;
  material?: string;
  /** roof, `#rrggbb` */
  roof_colour?: string;
}

/** A mapped wall material → the palette family it reads as. Glass and metal
 *  also set a flag the clay shows (a cool sheen, lib/city/city-mesh.ts). */
const MATERIAL_FAMILY: Record<string, FamilyKey> = {
  brick: "brick",
  stone: "cool",
  concrete: "neutral",
  glass: "cool",
  metal: "cool",
  wood: "warm",
  plaster: "warm",
};

/** Where a mapped colour's lightness is held (HSL, 0–1): walls stay pale,
 *  roofs may be darker — the clay's register, whatever a mapper wrote. */
const WALL_LIGHTNESS: [number, number] = [0.45, 0.9];
const ROOF_LIGHTNESS: [number, number] = [0.3, 0.8];
/** And its saturation: a red wall stays a dusty red, not a signal. */
const MAX_SATURATION = 0.45;

function hslOf(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h / 6, sat, l];
}

function rgbOfHsl(h: number, sat: number, l: number): [number, number, number] {
  if (sat === 0) {
    return [l, l, l];
  }
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    const t = t0 - Math.floor(t0);
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/**
 * A mapped colour (`#rrggbb`) brought into the clay's register: its hue
 * kept, its saturation capped and its lightness held in `range`, with the
 * same per-building lightness jitter as the palettes. Null when the value
 * is not a colour.
 */
export function osmColourTint(
  objectId: string,
  hex: string,
  range: [number, number] = WALL_LIGHTNESS
): TintRgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (!m) {
    return null;
  }
  const [h, sat, l] = hslOf(
    Number.parseInt(m[1], 16) / 255,
    Number.parseInt(m[2], 16) / 255,
    Number.parseInt(m[3], 16) / 255
  );
  const jitter = (hash01(`${objectId}#L`) - 0.5) * 2 * LIGHT_JITTER;
  const held = Math.min(Math.max(l, range[0]), range[1]) + jitter;
  const [r, g, b] = rgbOfHsl(h, Math.min(sat, MAX_SATURATION), clamp01(held));
  return [
    srgbChannelToLinear(r),
    srgbChannelToLinear(g),
    srgbChannelToLinear(b),
  ];
}

/** Reads a `Record<string, unknown>` field as a string without `any`. */
function readString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function readNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Where a building's wall colour comes from, as `buildingTint` decides it
 * (the inquiry card names it, lib/city/drawn-facts.ts): OSM's
 * `building:colour`, else a palette — the mapped `building:material`'s,
 * the neighbourhood's brick, or its use's.
 */
export type WallColourSource = "osm" | "material" | "brick" | "use";

/** The palette a wall draws from where OSM maps no colour, and why. */
function wallFamily(
  attrs: Record<string, unknown>,
  facades: FacadeMaterial,
  look: OsmLook
): { family: FamilyKey; from: Exclude<WallColourSource, "osm"> } {
  const fn = readString(attrs.function);
  const use = familyOf(fn);
  const material = look.material ? MATERIAL_FAMILY[look.material] : undefined;
  if (material) {
    return { family: material, from: "material" };
  }
  return facades === "brick" && !isStructure(fn)
    ? { family: "brick", from: "brick" }
    : { family: use, from: "use" };
}

/** Whether an ALKIS function code is a structure that is no building
 *  (a non-`31001` major: tanks, canopies, towers, chimneys). */
export function isStructure(fn: string | undefined): boolean {
  return fn !== undefined && fn.split("_")[0] !== "31001";
}

/** Where `buildingTint` takes a building's wall colour from. */
export function wallColourSource(
  attrs: Record<string, unknown> = {},
  facades: FacadeMaterial = "render",
  look: OsmLook = {}
): WallColourSource {
  if (look.colour && osmColourTint("", look.colour)) {
    return "osm";
  }
  return wallFamily(attrs, facades, look).from;
}

/** Whether a building's walls are brick, as `buildingTint` reads them (a
 *  mapped brick, or a brick neighbourhood): a brick front has no plastered
 *  Fasche round its windows (lib/city/windows.ts). */
export function brickWalls(
  attrs: Record<string, unknown> = {},
  facades: FacadeMaterial = "render",
  look: OsmLook = {}
): boolean {
  return wallFamily(attrs, facades, look).family === "brick";
}

/**
 * Stable linear-RGB tint for one building. `objectId` seeds the hash (so the
 * same building always gets the same colour across reloads/demolish), `attrs`
 * is the CityJSON `attributes` bag (`function`, `measuredHeight`), `facades`
 * what the walls around it are made of.
 */
export function buildingTint(
  objectId: string,
  attrs: Record<string, unknown> = {},
  facades: FacadeMaterial = "render",
  look: OsmLook = {}
): TintRgb {
  if (look.colour) {
    const own = osmColourTint(objectId, look.colour, WALL_LIGHTNESS);
    if (own) {
      return own;
    }
  }
  const family = FAMILIES[wallFamily(attrs, facades, look).family];
  const pick =
    family[
      Math.min(family.length - 1, Math.floor(hash01(objectId) * family.length))
    ];

  let r = pick[0] / 255;
  let g = pick[1] / 255;
  let b = pick[2] / 255;

  // Taller buildings drift cooler (less red, more blue) — a soft "stone vs.
  // plaster" cue. Centred so mid-height blocks are untouched.
  const height = readNumber(attrs.measuredHeight);
  if (height !== undefined) {
    const t = clamp01((height - COOL_START_M) / (COOL_END_M - COOL_START_M));
    const shift = (t - 0.5) * 2 * COOL_SHIFT;
    r = clamp01(r - shift);
    b = clamp01(b + shift);
  }

  // Decorrelated lightness jitter so same-family neighbours still separate.
  const jitter = (hash01(`${objectId}#L`) - 0.5) * 2 * LIGHT_JITTER;
  r = clamp01(r + jitter);
  g = clamp01(g + jitter);
  b = clamp01(b + jitter);

  return [
    srgbChannelToLinear(r),
    srgbChannelToLinear(g),
    srgbChannelToLinear(b),
  ];
}

/** Roof swatches (sRGB 0..255). Muted on purpose so they read as soft terracotta
 *  or slate under the watercolour grade, never fire-engine tiles. */
const ROOF_FAMILIES = {
  // Pitched / tiled — warm terracotta & brick (the Dresden old-town default).
  tiled: [
    [176, 99, 72],
    [161, 88, 64],
    [186, 112, 84],
    [150, 92, 71],
  ],
  // Flat / low-pitch — slate & lead grey.
  slate: [
    [128, 130, 132],
    [112, 118, 125],
    [140, 135, 128],
  ],
} as const;

/** AdV Dachform codes that are unambiguously pitched (so they get a tiled roof
 *  regardless of the — sometimes missing — pitch angle). */
const PITCHED_ROOF_CODES = new Set([
  "2100",
  "3100",
  "3200",
  "3300",
  "3400",
  "3500",
]);
/** Below this roof pitch (deg) a roof of unknown shape reads as flat/slate. */
const FLAT_PITCH_DEG = 8;

function roofIsTiled(attrs: Record<string, unknown>): boolean {
  const rt = readString(attrs.roofType);
  if (rt === "1000") {
    return false; // Flachdach
  }
  if (rt && PITCHED_ROOF_CODES.has(rt)) {
    return true;
  }
  const pitch = readNumber(attrs.Dachneigung);
  if (pitch !== undefined) {
    return pitch >= FLAT_PITCH_DEG;
  }
  return true; // unknown shape & pitch → old-town default is tiled
}

/**
 * Stable linear-RGB ROOF tint, chosen from `roofType` + `Dachneigung`: warm
 * terracotta for pitched/tiled roofs, cool slate for flat ones, with the same
 * per-building hash jitter as the walls (decorrelated via a `#roof` salt).
 */
export function roofTint(
  objectId: string,
  attrs: Record<string, unknown> = {}
): TintRgb {
  const family = roofIsTiled(attrs) ? ROOF_FAMILIES.tiled : ROOF_FAMILIES.slate;
  const pick =
    family[
      Math.min(
        family.length - 1,
        Math.floor(hash01(`${objectId}#roof`) * family.length)
      )
    ];
  const jitter = (hash01(`${objectId}#roofL`) - 0.5) * 2 * LIGHT_JITTER;
  const r = clamp01(pick[0] / 255 + jitter);
  const g = clamp01(pick[1] / 255 + jitter);
  const b = clamp01(pick[2] / 255 + jitter);
  return [
    srgbChannelToLinear(r),
    srgbChannelToLinear(g),
    srgbChannelToLinear(b),
  ];
}

/**
 * Per-building roof colour LUT baked from the DOP orthophoto
 * (`pipeline/bake/roof_colour.py`): CityJSON object id → LINEAR rgb sampled
 * under the roof footprint. Keys are the raw CityObject id strings, the same
 * ids `Object.keys(CityObjects)` yields, so they line up with the loader's
 * per-vertex `objectid` index.
 */
export type RoofColorLut = Record<string, TintRgb>;

/** Where a roof's colour comes from, as `roofColor` decides it: the
 *  orthophoto, OSM's `roof:colour`, or the palette by its form. */
export type RoofColourSource = "dop" | "osm" | "palette";

/** Where `roofColor` takes a roof's colour from. */
export function roofColourSource(
  objectId: string,
  lut?: RoofColorLut,
  look: OsmLook = {}
): RoofColourSource {
  if (lut?.[objectId]?.length === 3) {
    return "dop";
  }
  return look.roof_colour && osmColourTint("", look.roof_colour)
    ? "osm"
    : "palette";
}

/**
 * Roof colour for one building: the real DOP-sampled colour when the LUT has it,
 * then OSM's `roof:colour` in the clay's register, otherwise the synthesized
 * terracotta/slate palette. This is the source
 * preference baked into one place — present LUT entry wins, missing one (no DOP,
 * a roof too small to sample, a demolished/edited building) degrades to
 * `roofTint` so the look never breaks. See docs/transformations.md.
 */
export function roofColor(
  objectId: string,
  attrs: Record<string, unknown> = {},
  lut?: RoofColorLut,
  look: OsmLook = {}
): TintRgb {
  const sampled = lut?.[objectId];
  switch (roofColourSource(objectId, lut, look)) {
    case "dop":
      return sampled
        ? [sampled[0], sampled[1], sampled[2]]
        : roofTint(objectId, attrs);
    case "osm":
      // no measured colour: what OSM says, in the clay's register
      return (
        osmColourTint(
          `${objectId}#roof`,
          look.roof_colour ?? "",
          ROOF_LIGHTNESS
        ) ?? roofTint(objectId, attrs)
      );
    case "palette":
      return roofTint(objectId, attrs);
  }
}

/**
 * The roof colour bake's file (pipeline/bake/roof_colour.py): every
 * sampled building's colour (`roofs`) and the roof faces whose own colour
 * differs from it (`faces`: per object `[geometry, surface, r, g, b]`, the
 * loader's `geometryid` and `boundaryid`; `parts`: per object rebuilt from
 * DOM1 `[part, z, r, g, b]`, the part's index among the object's in its
 * roofs file and its level) and the roofs the build appends to LoD2's
 * (`scan`: the laser scan's sheds, `smallbuild_<tile>`; `gaps`: the
 * buildings and roofs on posts beyond LoD2, `structures_<tile>`; each row
 * `[index, z, r, g, b]`, the feature's index in its file and its `z`, which
 * the build checks), all linear RGB read from the orthophoto's sunlit
 * texels.
 */
export interface RoofColours {
  faces?: Record<string, readonly (readonly number[])[]>;
  gaps?: readonly (readonly number[])[];
  parts?: Record<string, readonly (readonly number[])[]>;
  roofs?: RoofColorLut;
  scan?: readonly (readonly number[])[];
}

/**
 * An object's attributes resolved through the root of its building tree: the
 * object's own value first, the root's as the fallback. In the Saxon LoD2 a
 * `BuildingPart` carries its geometry, heights and roof, but never the ALKIS
 * `function` — only its geometry-less parent `Building` does — so reading
 * the part alone gave every part of a shop or school the housing tint and
 * no dusk glow. `root` is undefined (or the object's own bag) for a root.
 */
export function inheritedAttributes(
  own: Record<string, unknown> = {},
  root?: Record<string, unknown>
): Record<string, unknown> {
  if (!root || root === own) {
    return own;
  }
  const out: Record<string, unknown> = { ...root };
  for (const [key, value] of Object.entries(own)) {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

/** ALKIS functions whose facade is its own: palaces, theatres, concert
 *  halls, museums, castles, churches, synagogues, chapels, houses of
 *  worship, mosques, temples, monasteries, parliaments. */
const MONUMENTAL = new Set([
  "31001_3011",
  "31001_3031",
  "31001_3032",
  "31001_3033",
  "31001_3034",
  "31001_3038",
  "31001_3040",
  "31001_3041",
  "31001_3042",
  "31001_3043",
  "31001_3045",
  "31001_3046",
  "31001_3047",
  "31001_3048",
]);
/** A storey taller than this (m) is a hall's, not a storey house's. */
const HALL_STOREY_M = 5.5;
/** ALKIS's public buildings (`31001_3xxx`: offices, courts, academies,
 *  schools, barracks, hospitals). */
const PUBLIC_FUNCTION = "31001_3";

/**
 * Whether a building's facade is its own rather than a storey house's:
 * a monumental use (`MONUMENTAL`, the Building's ALKIS function), storeys
 * OSM counts that are taller than `HALL_STOREY_M` (a hall, a nave), or a
 * listed public building (OSM `heritage`, ALKIS `31001_3xxx`) whose
 * storeys OSM does not count: its storeys are a palace's, 5–7 m, and the
 * 3.2 m a storey the height alone gives drew twice its rows of windows
 * (the Ständehaus ten, the Kunstakademie seven). LoD2's own
 * `storeysAboveGround` is no count: it is the height over about 3 m.
 * Such a facade gets no painted plinth or cornices, no drawn doors and no
 * windows — they are a town house's, and a church in them looks dressed
 * up; once OSM counts its storeys, a listed school or office keeps them.
 */
export function ownFacade(
  attrs: Record<string, unknown> = {},
  eaveH = 0,
  levels = 0,
  heritage = false
): boolean {
  return ownFacadeReason(attrs, eaveH, levels, heritage) !== null;
}

/** Why a facade is its own (`ownFacade`): its monumental use, the storeys
 *  OSM counts being a hall's, or a listed public building's storeys OSM
 *  does not count; null where it is a storey house's. */
export function ownFacadeReason(
  attrs: Record<string, unknown> = {},
  eaveH = 0,
  levels = 0,
  heritage = false
): "hall" | "listed" | "use" | null {
  const fn = readString(attrs.function);
  if (fn && MONUMENTAL.has(fn)) {
    return "use";
  }
  if (levels > 0) {
    return eaveH / levels > HALL_STOREY_M ? "hall" : null;
  }
  return heritage && (fn?.startsWith(PUBLIC_FUNCTION) ?? false)
    ? "listed"
    : null;
}

/** ALKIS's public buildings a palace's windows fit (`31001_3010`–`3072`:
 *  administration, education, culture, health, police and fire service) —
 *  not a barracks, a bunker or a prison (3073–3075), a station,
 *  a cemetery's or a sports hall (3080 on), whose walls are a hall's. */
const PALACE = { from: "31001_3010", to: "31001_3072" } as const;
/** … but its religious buildings and fortresses (`31001_3038`–`3048`):
 *  a nave's, a tower's or a bastion's facade has no rows of windows. */
const NO_PALACE = { from: "31001_3038", to: "31001_3048" } as const;

/**
 * Whether a facade of its own (`ownFacade`) is a palace's: a public
 * building (`PALACE`) that is not a church, a chapel, a synagogue or a
 * fortress — a Schloss, a museum, a parliament, a court, an academy, a
 * theatre, a hospital; not a station or a sports hall. Its windows are drawn as a palace's
 * (lib/city/windows.ts, type `palace`): tall storeys, tall windows; the
 * originals are densely windowed (the Zwinger's galleries, the
 * Albertinum, the Japanisches Palais).
 */
export function palatialFacade(attrs: Record<string, unknown> = {}): boolean {
  const fn = readString(attrs.function);
  return (
    fn !== undefined &&
    fn >= PALACE.from &&
    fn <= PALACE.to &&
    (fn < NO_PALACE.from || fn > NO_PALACE.to)
  );
}

/**
 * Whether a building part's facade is its own: its own reading
 * (`ownFacade`), or its building's where OSM's storeys do not fit the
 * part (`countsStoreys`) — the count is then the building's, inherited.
 * The Kulturpalast's raised roof (3.6 m of wall under the three storeys
 * of the hall it stands on) drew windows of its own.
 */
export function partFacade(
  own: boolean,
  building: boolean,
  eaveH: number,
  levels?: number
): boolean {
  return own || (building && !countsStoreys(eaveH, levels));
}

/**
 * Whether a building is lit at its foot after dark (the clay's Lichtkegel):
 * commerce (`31001_2xxx`) and public buildings (`31001_3xxx`) — shop
 * windows, entrances, forecourts. Housing (`31001_9998`/`1xxx`) stays dark,
 * so the lit centre reads as civic, and so does every structure that is no
 * building (non-`31001`: tanks, canopies, chimneys, cranes, pylons — they
 * have no entrance to light; 22 % of Hamburg's lit objects were one). A
 * landmark's floodlight is its own (OBJECT_FLAG_FLOODLIT), whatever its use.
 */
export function buildingGlows(attrs: Record<string, unknown> = {}): boolean {
  const fn = readString(attrs.function);
  if (!fn) {
    return false;
  }
  const [major, minor = ""] = fn.split("_");
  if (major !== "31001") {
    return false;
  }
  return minor.startsWith("2") || minor.startsWith("3");
}

/**
 * Storey height (m) for the contour bands: snap the building height to whole
 * ~3.2 m storeys so the topmost band lands near the eave. Clamped to a sane
 * range; falls back to 3 m when no height is known.
 */
export function storeyHeight(heightMeters: number | undefined): number {
  if (heightMeters === undefined || heightMeters < 2.5) {
    return 3;
  }
  const storeys = Math.max(1, Math.round(heightMeters / 3.2));
  return Math.min(Math.max(heightMeters / storeys, 2.5), 4.5);
}

/** A storey OSM's `building:levels` may give, in metres: outside this the
 *  count belongs to another part (a tower inheriting its nave's levels) or
 *  is a typo, and the estimate from the height stands. */
const MAPPED_STOREY = { min: 2.4, max: 5.5 } as const;

/**
 * Storey height (m) for the contour bands of a building whose storeys OSM
 * counts (`building:levels`, the storeys below the roof): the walls up to
 * the eave divided by that count, so each band lies on a real floor — a
 * Gründerzeit block's 4 m storeys and a Plattenbau's 2.8 m ones differ.
 * Without a count, or where it gives an implausible storey, the walls up to
 * the eave split into whole storeys of about its neighbours' (`near`,
 * `neighbourStorey`); without those, `storeyHeight` of the measured height.
 */
export function mappedStoreyHeight(
  eaveMeters: number,
  measuredMeters: number | undefined,
  levels: number | undefined,
  near?: number
): number {
  if (countsStoreys(eaveMeters, levels) && levels) {
    return eaveMeters / levels;
  }
  return near !== undefined && near > 0 && eaveMeters >= 2.5
    ? neighbourStorey(eaveMeters, near)
    : storeyHeight(measuredMeters);
}

/**
 * The storey (m) of walls `eaveMeters` high whose neighbours' storeys are
 * `near` (osm_buildings.py `storey`: the median of OSM's counts on the
 * mapped buildings within 200 m of its roof form and about its eave, else
 * the tile's): the eave split into whole storeys of about that, held to
 * 2.5–4.5 m. Counted from the eave, not from the whole height in 3.2 m
 * storeys: Leipzig's Gründerzeit storeys are 3.7 m, and the old estimate
 * matched OSM's count on 34 % of its mapped buildings, this one on 65 %
 * (Hamburg 36 → 49 %, München 49 → 63 %, Meißen 53 → 79 %, Grimma 56 →
 * 84 %, Unna 84 → 92 %, Dresden 49 → 75 %; each building left out of its
 * own neighbours).
 */
export function neighbourStorey(eaveMeters: number, near: number): number {
  const n = Math.max(1, Math.round(eaveMeters / near));
  return Math.min(Math.max(eaveMeters / n, 2.5), 4.5);
}

/** Whether OSM's `levels` give walls of `eaveMeters` a plausible storey
 *  (`MAPPED_STOREY`). */
export function countsStoreys(
  eaveMeters: number,
  levels: number | undefined
): boolean {
  if (levels === undefined || levels < 1) {
    return false;
  }
  const storey = eaveMeters / levels;
  return storey >= MAPPED_STOREY.min && storey <= MAPPED_STOREY.max;
}

/** Signed per-building roughness jitter in [-1,1] (decorrelated hash). */
export function roughJitter(objectId: string): number {
  return hash01(`${objectId}#R`) * 2 - 1;
}
