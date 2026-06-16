/**
 * Per-building clay tint — pure, DOM/three-free so it unit-tests under `bun test`
 * and runs in the offline annotate step.
 *
 * The default clay material paints every building the same flat colour, so a
 * dense old-town block reads as one uniform mass. This derives a *stable* tint
 * per building and the clay shader blends it into the base colour (strength is a
 * live HUD slider — see `uTint` in visual-style). Two signals drive it:
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
} as const;

type FamilyKey = keyof typeof FAMILIES;

/** Height (m) at which the warm→cool shift starts and saturates. */
const COOL_START_M = 6;
const COOL_END_M = 30;
/** Max channel push of the height-driven warm/cool shift (sRGB units). */
const COOL_SHIFT = 0.05;
/** Max per-building lightness jitter (sRGB units), from a decorrelated hash. */
const LIGHT_JITTER = 0.03;

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

/**
 * Deterministic, well-spread string hash → float in [0,1), with no bitwise ops
 * (biome bans them). A polynomial roll in a 31-bit ring gives a distinct,
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

/** Reads a `Record<string, unknown>` field as a string without `any`. */
function readString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function readNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Stable linear-RGB tint for one building. `objectId` seeds the hash (so the
 * same building always gets the same colour across reloads/demolish), `attrs`
 * is the CityJSON `attributes` bag (`function`, `measuredHeight`).
 */
export function buildingTint(
  objectId: string,
  attrs: Record<string, unknown> = {}
): TintRgb {
  const family = FAMILIES[familyOf(readString(attrs.function))];
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
 * Whether a building earns a warm interior glow at dusk: commerce
 * (`31001_2xxx`), public (`31001_3xxx`) and special structures (non-`31001`).
 * Housing (`31001_9998`/`1xxx`) stays dark, so the lit centre reads as civic.
 */
export function buildingGlows(attrs: Record<string, unknown> = {}): boolean {
  const fn = readString(attrs.function);
  if (!fn) {
    return false;
  }
  const [major, minor = ""] = fn.split("_");
  if (major !== "31001") {
    return true;
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

/** Signed per-building roughness jitter in [-1,1] (decorrelated hash). */
export function roughJitter(objectId: string): number {
  return hash01(`${objectId}#R`) * 2 - 1;
}
