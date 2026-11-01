/**
 * The windows the clay draws on the facades (app/_components/
 * clay-windows.ts): a building's window rhythm, here, and per wall where
 * its windows may go, as the building bake hands both to the shader
 * (scripts/bake-city-mesh.ts) — no window is geometry.
 *
 * **The rhythm** is one row of the object table per building (its fourth
 * band, `WindowSpec`): the axes' spacing, a window's width and height, and
 * a style (a loose grid, a Fasche, a Verdachung, the reveal's depth, the
 * sill's height over the storey line). It comes, best first, from
 *  - the street photos' traits measured on one of the building's own walls
 *    (pipeline/bake/windows.py, `model`: each feature only where two drives
 *    agree at Spearman ρ ≥ 0.6),
 *  - another part of the same building that was measured,
 *  - the nearest measured building of its kind (`NEAR_M`, the same roof
 *    form, an eave of about its height): the house next door shares its
 *    era,
 *  - its type (`TYPES`): a tall or a low storey under a pitched roof (or a
 *    flat-roofed town house, `flatTownHouse`), a small house, a
 *    flat-roofed block or a low flat-roofed building.
 * None on a building whose facade is its own (a landmark, a church, a
 * hall: flag 16), on glass or metal cladding, on a garage, a shed, a
 * warehouse or a plant, on any structure that is no building (a tank, a
 * crane, a chimney: `windowless`), or on anything under 3.2 m of wall.
 * The storey height snaps to the eave (`windowStorey`), so the top row
 * sits under the Traufgesims on every house.
 *
 * **Where** is four numbers per wall vertex (`facadeAttribute`, the glTF's
 * `_FACADE`): metres along the wall from its middle, the wall's length
 * (negative where its ground floor has no window: over a shopfront, or
 * with more doors than the two below), and where up to two of OSM's doors
 * stand along it and how wide they are (no ground-floor window within
 * `DOOR_GAP_M` of one) — the second slot, where it holds no door, the
 * wall's own eave (`WALL_EAVE`): a front rising to a higher roof than its
 * object's lowest keeps its windows up to its own. A wall is one plane of
 * one object's triangles, edge-connected; a party wall — one another wall
 * stands against, back to back — gets none, but a low house's above its
 * neighbour's top (`PARTY_LOW_EAVE_M`).
 *
 * Where the drives that photographed a wall registered onto each other
 * (pipeline/bake/window_axes.py, `FacadeModel.phase`), its axes stand where
 * the photos saw them (`measuredAxes`, `measuredColumns`); elsewhere they
 * are centred on the wall. Pure, no DOM.
 */

import { isStructure } from "./building-tint";
import { OPEN_ROOF_FUNCTIONS } from "./open-roofs";

/** What windows.py models on a wall (metres). */
export interface FacadeModel {
  /** the axes' spacing along the wall */
  axis: number;
  /** a band of horizontal joints recurring at the storey under the
   *  windows (not drawn: it did not agree between two drives) */
  sill?: boolean;
  /** a set-off surround round each window */
  frame?: boolean;
  /** a regular grid, or a loose one (the axes a little off) */
  grid: "loose" | "regular";
  /** the window's height */
  h: number;
  /** where an axis stands: metres from the wall's start `a`, in [0, axis)
   *  — where the drives that saw the wall registered onto each other
   *  (pipeline/bake/window_axes.py); else the axes are centred */
  phase?: number;
  /** flat lisenes between the axes (not drawn: no agreement) */
  lisene?: boolean;
  /** much fine texture in the plaster: ornament */
  orn?: boolean;
  /** the storey's height, where it was measured */
  storey?: number;
  /** the window's width */
  w: number;
}

/** A measured wall (`windows_<tile>.json`): its frame as in
 *  shopfronts_<tile>.json, the traits, and the model where one is drawn. */
export interface WindowWall {
  a: [number, number];
  b: [number, number];
  eave: number;
  imgs: number;
  L: number;
  model?: FacadeModel;
  n: [number, number];
  oid: string;
  seqs: number;
  traits: Record<string, number>;
  wi: number;
  z?: [number, number];
}

/** A tile's facade traits, per Building gml:id. */
export interface WindowFile {
  attribution: string;
  buildings: Record<string, WindowWall[]>;
  /** per feature [Spearman ρ between two sequences, walls] on this tile */
  reliability: Record<string, [number | null, number]>;
}

/**
 * A building's windows as the clay draws them (the object table's fourth
 * band): the axes' spacing (0: none), a window's width and height (m) and
 * its style (`WINDOW_STYLE`).
 */
export interface WindowSpec {
  axis: number;
  h: number;
  style: number;
  w: number;
}

/** No windows. */
export const NO_WINDOWS: WindowSpec = { axis: 0, h: 0, style: 0, w: 0 };

/**
 * The style's bits (one UINT32 column, exact in the object table's float
 * texel below 2²⁴; the shader decodes the same):
 *  - `loose`: the axes are a little off a regular grid (`LOOSE_JITTER`);
 *  - `frame`: a Fasche, a set-off band round each window;
 *  - `lintel`: a Verdachung, a small cornice over each window (ornament);
 *  - `noGround`: no window on the ground floor (a shop's);
 *  - `measured`/`near`: where the rhythm comes from (its own walls, a
 *    neighbour's; neither: its type) — the shader ignores both;
 *  - the reveal's depth class from bit 6 (`WINDOW_DEPTH`), the sill's
 *    height over the storey line from bit 9 (`WINDOW_SILL`);
 *  - the ground floor's lift from bit 16 (`WINDOW_LIFT`): its windows
 *    start that much higher than the upper floors' over their storey
 *    line — a Hochparterre's (`WINDOW_ROWS.raise`), or clear of the
 *    plinth's top (`WINDOW_ROWS.plinthGap`) —, their heads where they
 *    were.
 */
export const WINDOW_STYLE = {
  loose: 1,
  frame: 2,
  lintel: 4,
  noGround: 8,
  measured: 16,
  near: 32,
  depth: 64,
  sill: 512,
  lift: 65_536,
} as const;

/** The reveal's depth: `base + step · class`, class 0–7 (6–27 cm). */
export const WINDOW_DEPTH = { base: 0.06, step: 0.03, classes: 8 } as const;
/** The sill's height over its storey line: `base + step · class`, class
 *  0–15 (0.5–1.25 m). */
export const WINDOW_SILL = { base: 0.5, step: 0.05, classes: 16 } as const;
/** The ground floor's lift: `step · class`, class 0–31 (0–1.55 m). */
export const WINDOW_LIFT = { base: 0, step: 0.05, classes: 32 } as const;

/**
 * The rows and columns (m): wall kept at either end of a wall beside the
 * outer windows (`edge`), at least between two windows (`gap`), under the
 * next storey line (`lintel`) and under the eave (`eaveClear`, the
 * Traufgesims: a top floor's windows end there, a little shorter if they
 * must); a window smaller than `min` either way is none. The first storey
 * line is the object's `storeyH` over its base, but never under
 * `firstLine`. A raised ground floor's windows start `raise` higher, and
 * every ground floor's `plinthGap` over its plinth's top; where that
 * leaves them less tall than `squat` of their width, it has none.
 */
export const WINDOW_ROWS = {
  edge: 0.7,
  eaveClear: 0.5,
  firstLine: 2.4,
  gap: 0.45,
  lintel: 0.3,
  min: 0.55,
  plinthGap: 0.2,
  raise: 0.45,
  squat: 0.8,
} as const;

/** A loose grid shifts each axis by up to this share of the spacing. */
export const LOOSE_JITTER = 0.08;

/** A ground-floor window keeps this much wall between its opening and a
 *  door's (m): the door's surround (lib/city/doors.ts `DOOR_SURROUND`,
 *  0.14), the window's sill, Fasche or Verdachung (up to 0.21) and a pier
 *  of plain wall between. */
export const DOOR_GAP_M = 0.6;

/** The `_FACADE` attribute's metres per unit along the wall and for its
 *  length (snorm16: 1.6 cm a step, ±512 m). */
export const FACADE_SCALE_M = 512;
/** `_FACADE`'s door slot when no door stands on the wall (its code
 *  32 767). */
export const NO_DOOR = 1;
/** `_FACADE`'s first door slot on a roof vertex (its code −32 767): the
 *  clay's roof flag rides there, a vertex buffer less (a door's code never
 *  comes near, `DOOR_SLOT`). */
export const FACADE_ROOF = -1;

/**
 * A wall whose axes the drives placed (`FacadeAxes`) holds in `_FACADE`'s
 * length slot, instead of its length, the snorm16 code `base + n · perN +
 * round((axis − axis0) / step)`, signed as a length is: its `n` axes at
 * its own measured spacing (`axis0` to `axis0 + (perN − 1) · step` m),
 * centred on its middle — a house's front and side often keep different
 * rhythms, its object's spec one. No length reaches `base` (`LENGTH_MAX_M`).
 */
export const MEASURED_AXES = {
  base: 16_384,
  perN: 256,
  axis0: 1,
  step: 0.02,
  maxN: 63,
} as const;
/** The widest spacing a measured wall's slot holds (m). */
export const MEASURED_AXIS_MAX_M =
  MEASURED_AXES.axis0 + (MEASURED_AXES.perN - 1) * MEASURED_AXES.step;
/** The longest wall `_FACADE`'s length slot holds as a length (m). */
export const LENGTH_MAX_M =
  ((MEASURED_AXES.base - 1) / 32_767) * FACADE_SCALE_M;

/**
 * A door slot of `_FACADE` (its third and fourth number) holds the snorm16
 * code `place · widths + class`: the door's place along the wall from the
 * wall's middle in `step` m, held to ±`reach` m (so no code comes near
 * ±32 767, the roof's flag and no door), and its width class, the door's
 * width rounded up to a class (`doorClassWidth`): from `w0` in `wStep` m
 * for `fine` classes, then in `wideStep` m — 0.6–2 m in 0.2 m, then 3, 4,
 * 5 and 6 m, the widest the doors bake takes (pipeline/bake/doors.py).
 */
export const DOOR_SLOT = {
  fine: 7,
  reach: 270,
  step: 0.1,
  w0: 0.6,
  wideStep: 1,
  widths: 12,
  wStep: 0.2,
} as const;
/** The codes from here on either side are no door (`NO_DOOR`,
 *  `FACADE_ROOF`). */
export const DOOR_NONE_CODE = 32_767;

/**
 * A wall's own eave, in `_FACADE`'s second door slot (its fourth number)
 * wherever that holds no door — a wall with at most one, or one without
 * ground-floor windows, whose doors keep none off: the snorm16 code
 * `code0 + k`, the wall's eave `k · step` m over its object's (k 1–354, so
 * up to 35.4 m); `NO_DOOR` (32 767) is the object's eave. The codes lie
 * past every door's — a door slot's codes end at 32 411 (`DOOR_SLOT`:
 * ±270 m in 0.1 m steps, 12 width classes) — so a door test that reads
 * one finds a door 270 m off, which keeps no window off. Keep `code0` above
 * `reach / step · widths + widths − 1` if the doors' reach or classes
 * change. The clay lifts its eave there (visual-style.ts):
 * the top row of windows, the eave's stroke and the Denkmal's line follow
 * the wall's own roof edge.
 */
export const WALL_EAVE = { code0: 32_412, step: 0.1, top: 32_766 } as const;

/** A wall's eave `up` m over its object's as its door slot's code
 *  (`WALL_EAVE`), the object's (`NO_DOOR`) under half a step. */
export function wallEaveSlot(up: number): number {
  const k = Math.min(
    Math.round(up / WALL_EAVE.step),
    WALL_EAVE.top - WALL_EAVE.code0
  );
  return k >= 1 ? WALL_EAVE.code0 + k : Math.round(NO_DOOR * 32_767);
}

/** How far a door slot's code lifts its wall's eave over its object's
 *  (m): 0 for a door, `NO_DOOR` and the roof's flag. The clay's decoding. */
export function slotWallEave(code: number): number {
  return code >= WALL_EAVE.code0 && code <= WALL_EAVE.top
    ? (code - WALL_EAVE.code0) * WALL_EAVE.step
    : 0;
}

/** Walls of at least this height carry windows (m, the object's eave). */
const MIN_EAVE_M = 3.2;

/** The building functions (ALKIS, `31001_…` prefixes) that have no
 *  windows to speak of: garden houses, kiosks, petrol stations and car
 *  washes, warehouses, shelters and vehicle halls, garages and parking,
 *  plants and utility buildings, barns, sheds, stables, greenhouses — and
 *  the roofs on posts (`51009_1610` Überdachung, `51009_1611` Carport),
 *  whose walls the build cuts to a fascia (lib/city/open-roofs.ts). */
const WINDOWLESS = [
  ...OPEN_ROOF_FUNCTIONS,
  "31001_1313",
  "31001_2055",
  "31001_213",
  "31001_2140",
  "31001_2141",
  "31001_2143",
  "31001_2412",
  "31001_2422",
  "31001_2431",
  "31001_2441",
  "31001_2442",
  "31001_246",
  "31001_25",
  "31001_26",
  "31001_272",
  "31001_274",
] as const;

/** Whether a building function has no windows: a use in `WINDOWLESS`, or
 *  a structure that is no building in ALKIS's terms (lib/city/
 *  building-tint.ts `isStructure`: every function outside `31001` — tanks
 *  and silos, cranes, chimneys, masts, canopies; 169 of Hamburg's 422
 *  tanks, 22 of its 25 cranes and 22 of Leipzig's chimneys drew rows of
 *  windows). */
export function windowless(fn: string | undefined): boolean {
  return (
    fn !== undefined &&
    (isStructure(fn) || WINDOWLESS.some((p) => fn.startsWith(p)))
  );
}

// --- the style --------------------------------------------------------------

/** What a style says, decoded. */
export interface WindowStyle {
  depth: number;
  frame: boolean;
  lintel: boolean;
  loose: boolean;
  measured: boolean;
  near: boolean;
  noGround: boolean;
  /** the ground floor's lift (m, `WINDOW_LIFT`) */
  lift: number;
  sill: number;
}

const classOf = (
  m: number,
  scale: { base: number; step: number; classes: number }
) =>
  Math.min(
    scale.classes - 1,
    Math.max(0, Math.round((m - scale.base) / scale.step))
  );

/** A style from its parts (depth and sill in metres, to their class). */
export function packStyle(s: Partial<WindowStyle>): number {
  return (
    (s.loose ? WINDOW_STYLE.loose : 0) +
    (s.frame ? WINDOW_STYLE.frame : 0) +
    (s.lintel ? WINDOW_STYLE.lintel : 0) +
    (s.noGround ? WINDOW_STYLE.noGround : 0) +
    (s.measured ? WINDOW_STYLE.measured : 0) +
    (s.near ? WINDOW_STYLE.near : 0) +
    WINDOW_STYLE.lift * classOf(s.lift ?? 0, WINDOW_LIFT) +
    WINDOW_STYLE.depth * classOf(s.depth ?? 0.12, WINDOW_DEPTH) +
    WINDOW_STYLE.sill * classOf(s.sill ?? 0.9, WINDOW_SILL)
  );
}

/** A style's parts (the shader's decoding, in numbers). */
export function unpackStyle(style: number): WindowStyle {
  const bit = (b: number) => Math.floor(style / b) % 2 === 1;
  return {
    loose: bit(WINDOW_STYLE.loose),
    frame: bit(WINDOW_STYLE.frame),
    lintel: bit(WINDOW_STYLE.lintel),
    noGround: bit(WINDOW_STYLE.noGround),
    measured: bit(WINDOW_STYLE.measured),
    near: bit(WINDOW_STYLE.near),
    lift:
      WINDOW_LIFT.base +
      WINDOW_LIFT.step *
        (Math.floor(style / WINDOW_STYLE.lift) % WINDOW_LIFT.classes),
    depth:
      WINDOW_DEPTH.base +
      WINDOW_DEPTH.step *
        (Math.floor(style / WINDOW_STYLE.depth) % WINDOW_DEPTH.classes),
    sill:
      WINDOW_SILL.base +
      WINDOW_SILL.step *
        (Math.floor(style / WINDOW_STYLE.sill) % WINDOW_SILL.classes),
  };
}

// --- the rhythm ---------------------------------------------------------------

/** A building's type, as its windows go (`windowType`). */
export type WindowType =
  | "block"
  | "house"
  | "low"
  | "palace"
  | "storey"
  | "tall";

/**
 * Each type's windows (m): the axes' spacing, a window's width and height,
 * the reveal's depth, the sill over the storey line, and a loose grid.
 * Axis, width and height near the medians of Dresden's measured walls of
 * that type (`scripts/windows-report.ts` prints them), the depths and
 * sills as such houses are built: a Gründerzeit front's deep reveals, a
 * Plattenbau's shallow ones.
 */
export const TYPES: Record<
  WindowType,
  {
    axis: number;
    depth: number;
    /** a Fasche round each window: the town house's plastered surround */
    frame?: boolean;
    /** a Hochparterre: the ground floor's windows over the plinth */
    raised?: boolean;
    /** the window's head this far under the next storey line (m) */
    head: number;
    /** and the window no taller than this (m) */
    hMax: number;
    loose?: boolean;
    /** the median height the photos measured on Dresden's walls of this
     *  type (scripts/windows-report.ts, 2026-10-09): they read the
     *  openings short (the reveal's shade and the curtains), so a
     *  measured height scales the type's by its share of this */
    seen?: number;
    sill: number;
    w: number;
  }
> = {
  // pitched roof, storeys from 3.3 m: the town house of 1850–1914, its
  // tall windows' heads well under the next floor
  tall: {
    axis: 2.7,
    w: 1.15,
    head: 0.75,
    hMax: 2.4,
    seen: 1.63,
    depth: 0.18,
    sill: 0.85,
    frame: true,
    raised: true,
  },
  // pitched roof, lower storeys: the walk-up of 1920–1960
  storey: {
    axis: 2.7,
    w: 1.1,
    head: 0.55,
    hMax: 1.8,
    seen: 1.49,
    depth: 0.15,
    sill: 0.9,
  },
  // pitched roof, at most two storeys: a house
  house: {
    axis: 2.6,
    w: 0.95,
    head: 0.5,
    hMax: 1.45,
    seen: 1.22,
    depth: 0.12,
    sill: 0.9,
    loose: true,
  },
  // flat roof from 7 m: the slab, the Plattenbau, the office block
  block: {
    axis: 2.7,
    w: 1.2,
    head: 0.45,
    hMax: 1.6,
    seen: 1.46,
    depth: 0.09,
    sill: 0.85,
  },
  // flat roof, lower: a pavilion, a shop, a school wing
  low: { axis: 3, w: 1.4, head: 0.45, hMax: 1.6, depth: 0.09, sill: 0.85 },
  // a facade of its own that is a palace's (`WindowHost.palace`): a
  // Schloss, a museum, a parliament, a court — storeys of 5–7 m, tall
  // windows wide apart, deep reveals with a Fasche
  palace: {
    axis: 3.6,
    w: 1.45,
    head: 0.9,
    hMax: 3,
    depth: 0.21,
    sill: 0.9,
    frame: true,
    raised: true,
  },
};

/**
 * The highest ground (or plinth top) over its base a ground floor's
 * windows still clear (m): the lift's last class over the lowest sill,
 * `WINDOW_ROWS.plinthGap` under it. Where the ground along a wall rises
 * higher (a building on a slope, the Brühlsche Terrasse behind the
 * Albertinum) that wall's ground floor has no windows, its others keep
 * theirs (`facadeAttribute`'s shop sign).
 */
export const GROUND_REACH_M =
  (WINDOW_LIFT.classes - 1) * WINDOW_LIFT.step +
  Math.min(...Object.values(TYPES).map((t) => t.sill)) -
  WINDOW_ROWS.plinthGap;

/** A palace's storey where OSM counts none (m): the eave is split into
 *  whole storeys of about this. */
export const PALACE_STOREY_M = 5.5;
/** OSM's count gives a palace a storey of at most this (m); past it the
 *  count is a part's, and `PALACE_STOREY_M` stands. */
const PALACE_STOREY_MAX_M = 7.5;

/**
 * A palace's storey (m): its walls up to the eave over OSM's count where
 * that gives 2.4–7.5 m, else the eave split into whole storeys of about
 * `PALACE_STOREY_M`.
 */
export function palaceStorey(eaveH: number, storeys?: number): number {
  if (storeys !== undefined && storeys >= 1) {
    const s = eaveH / storeys;
    if (s >= 2.4 && s <= PALACE_STOREY_MAX_M) {
      return s;
    }
  }
  return eaveH / Math.max(1, Math.round(eaveH / PALACE_STOREY_M));
}

/** A pitched-roof storey this tall is a town house's (m). */
export const TALL_STOREY_M = 3.3;
/** At most this much wall is a house (m, the eave). */
const HOUSE_EAVE_M = 6.5;
/** A flat-roofed building from this eave is a block (m). */
const BLOCK_EAVE_M = 7;

/** A building's type from its roof, eave and storey; a flat-roofed town
 *  house (`town`, `flatTownHouse`) is one under a pitched roof. */
export function windowType(
  flat: boolean,
  eaveH: number,
  storeyH: number,
  town = false
): WindowType {
  if (flat && town) {
    return "tall";
  }
  if (flat) {
    return eaveH >= BLOCK_EAVE_M ? "block" : "low";
  }
  if (eaveH <= HOUSE_EAVE_M) {
    return "house";
  }
  return storeyH >= TALL_STOREY_M ? "tall" : "storey";
}

/** A flat-roofed house's storey from this height is a town house's (m),
 *  not a post-war slab's: 69 % of Leipzig's and Hamburg's flat-roofed
 *  houses with an eave from 9 m have storeys this tall (OSM's counts) —
 *  the Gründerzeit corner whose roof LoD2 draws flat. */
export const FLAT_TOWN_STOREY_M = 3.4;
/** … from this eave (m), three storeys: a lower flat-roofed house is an
 *  annex or a bungalow, its one storey as tall as the neighbours' (412
 *  "town houses" on Meißen's tile without it, four in five under 9 m). */
export const FLAT_TOWN_EAVE_M = 9;

/**
 * Whether a flat-roofed building is a town house all the same: housing
 * (ALKIS `31001` but no commerce `2xxx` or public `3xxx` use, or none
 * known) from `FLAT_TOWN_EAVE_M` of wall whose storeys are a town house's
 * (`FLAT_TOWN_STOREY_M`: OSM's count, or the neighbours' storey,
 * lib/city/building-tint.ts `mappedStoreyHeight`) or that is listed (OSM
 * `heritage`). It is drawn as one — the windows of type `tall`, the plinth
 * and cornices — not as a block.
 */
export function flatTownHouse(h: {
  eaveH: number;
  fn?: string;
  listed: boolean;
  storeyH: number;
}): boolean {
  const [major, minor = ""] = (h.fn ?? "31001_1000").split("_");
  const housing =
    major === "31001" && !minor.startsWith("2") && !minor.startsWith("3");
  return (
    housing &&
    h.eaveH >= FLAT_TOWN_EAVE_M &&
    (h.listed || h.storeyH >= FLAT_TOWN_STOREY_M)
  );
}

/**
 * The storey height the windows and the storey lines keep: `storeyH` (OSM's
 * levels, else the height's estimate), or the one the photos measured where
 * OSM counts none, snapped so that a whole number of storeys reaches the
 * eave — the top row then sits under the Traufgesims.
 */
export function windowStorey(
  eaveH: number,
  storeyH: number,
  measured?: number
): number {
  const base = measured ?? storeyH;
  if (eaveH < MIN_EAVE_M || base <= 0) {
    return storeyH;
  }
  const n = Math.max(1, Math.round(eaveH / base));
  const s = eaveH / n;
  return s >= 2.5 && s <= 4.8 ? s : storeyH;
}

/** What the rhythm reads of a building (its object row and more). */
export interface WindowHost {
  /** the footprint's centre (EPSG), for the neighbours */
  centre?: [number, number];
  eaveH: number;
  /** a flat roof (OBJECT_FLAG_FLAT_ROOF) */
  flat: boolean;
  /** its ALKIS function, inherited from its Building */
  fn?: string;
  /** OSM counts its storeys (its `storeyH` is theirs) */
  levels: boolean;
  /** drawn by LoD2 (the scan's sheds, the gaps and the parts on its
   *  walls get none) */
  lod2: boolean;
  /** the facade is its own (16), glass (4) or metal (8): no windows */
  ownFacade: boolean;
  /** … and that own facade is a palace's (lib/city/building-tint.ts
   *  `palatialFacade`): windows of type `palace` after all */
  palace?: boolean;
  /** how high the ground in front of its walls rises over its base (m),
   *  each reading (`wallRises`): its ground floor's windows keep over the
   *  highest they can (`WindowChoice.reach`) */
  ground?: readonly number[];
  /** how high its plinth stands over its base (m), where one is drawn:
   *  one more level its ground floor's windows keep over, like `ground` */
  plinth?: number;
  /** the root of its building tree */
  root: number;
  /** a shop on its ground floor (OSM) */
  shop: boolean;
  storeyH: number;
  /** the storeys OSM counts (a palace's storey reads them) */
  storeys?: number;
  /** a flat-roofed town house (`flatTownHouse`): windows of type `tall` */
  town?: boolean;
  /** brick walls (lib/city/building-tint.ts `brickWalls`): no type's
   *  Fasche — a plastered surround is a rendered front's */
  brick?: boolean;
}

/** Where a building's rhythm came from. */
export type WindowSource = "measured" | "near" | "none" | "tree" | "type";

/** Why a building draws no windows: not a LoD2 wall, a facade of its
 *  own (or glass, metal, its own colour), under `MIN_EAVE_M` of wall, a
 *  use without windows (`WINDOWLESS`), or no window fits its storey. */
export type NoWindows = "beyond" | "facade" | "low" | "small" | "use";

/** One building's windows and storey (`windowSpecs`). */
export interface WindowChoice {
  from: WindowSource;
  spec: WindowSpec;
  storey: number;
  /** the storey is the one the photos measured (else `storeyH`'s,
   *  snapped to the eave) */
  storeyFromPhotos?: boolean;
  /** why there are none (`from` "none") */
  why?: NoWindows;
  /** the highest ground over its base its ground floor's windows clear
   *  (m): a wall the ground rises higher in front of has none
   *  (`facadeAttribute`'s `rises`) */
  reach?: number;
}

/** A measured building lends its rhythm this far (m, centre to centre):
 *  the house next door or across the street, not the block's — at 150 m
 *  a 1900 front lent its rhythm to a 1960 one round the corner. */
export const NEAR_M = 30;
/** … to a building whose eave differs from its own by at most this
 *  (m, or this share of it). */
const NEAR_EAVE = { m: 4, share: 0.35 } as const;

/** The best-seen model on each object's measured walls (most images). */
function measuredModels(
  walls: readonly WindowWall[],
  index: ReadonlyMap<string, number>
): Map<number, FacadeModel> {
  const best = new Map<number, { imgs: number; m: FacadeModel }>();
  for (const w of walls) {
    const i = index.get(w.oid);
    if (!w.model || i === undefined) {
      continue;
    }
    const have = best.get(i);
    if (!have || w.imgs > have.imgs) {
      best.set(i, { imgs: w.imgs, m: w.model });
    }
  }
  return new Map([...best].map(([i, b]) => [i, b.m]));
}

/** The measured model nearest to a host (`NEAR_M`), of its roof form and
 *  about its eave; the score adds 10 m a metre of eave. */
function nearestModel(
  host: WindowHost,
  donors: readonly { host: WindowHost; m: FacadeModel }[]
): FacadeModel | undefined {
  const c = host.centre;
  if (!c) {
    return undefined;
  }
  let best: FacadeModel | undefined;
  let score = Number.POSITIVE_INFINITY;
  for (const d of donors) {
    const dc = d.host.centre;
    if (!dc || d.host.flat !== host.flat) {
      continue;
    }
    const de = Math.abs(d.host.eaveH - host.eaveH);
    if (de > Math.max(NEAR_EAVE.m, NEAR_EAVE.share * host.eaveH)) {
      continue;
    }
    const dist = Math.hypot(dc[0] - c[0], dc[1] - c[1]);
    const s = dist + 10 * de;
    if (dist <= NEAR_M && s < score) {
      score = s;
      best = d.m;
    }
  }
  return best;
}

/** A type's window height in a storey: its head `head` under the next
 *  storey line, at most `hMax`. */
export function typeHeight(type: WindowType, storey: number): number {
  const t = TYPES[type];
  return Math.min(storey - t.sill - t.head, t.hMax);
}

/**
 * How far a measured rhythm is drawn towards its type's: the ratio of the
 * measured to the type's value to a `power`, bounded. One wall's reading
 * is noisy — two drives agree on the axis at ρ 0.67, on the width at
 * 0.64, on the height (via its proportion) at 0.66 — and a row of houses
 * whose windows differ by half reads restless; the photos' house keeps
 * its character, nearer its type. The height's ratio is to what the
 * photos read on its type (`seen`): they read openings short.
 */
export const TOWARD_TYPE = {
  axis: { power: 0.75, lo: 0.75, hi: 1.35 },
  w: { power: 0.5, lo: 0.8, hi: 1.25 },
  h: { power: 0.5, lo: 0.85, hi: 1.2 },
} as const;

/** `ratio` drawn towards 1 (`TOWARD_TYPE`). */
const toward = (
  ratio: number,
  k: { power: number; lo: number; hi: number }
): number => Math.min(Math.max(ratio ** k.power, k.lo), k.hi);

/** A spec from a rhythm, fitted into the storey: its axis and width drawn
 *  towards its type's (`TOWARD_TYPE`), a measured window as tall as its
 *  type's in this storey times its height's share of what the photos read
 *  on that type (`seen`), the type's own as `typeHeight` gives it; the
 *  window under its lintel, a pier beside it, none smaller than
 *  `WINDOW_ROWS.min`. */
function fitted(
  r: { axis: number; h?: number; w: number },
  type: WindowType,
  style: Partial<WindowStyle> & { depth: number; sill: number },
  storey: number
): WindowSpec {
  const t = TYPES[type];
  const share =
    r.h !== undefined && t.seen ? toward(r.h / t.seen, TOWARD_TYPE.h) : 1;
  const h = Math.min(
    typeHeight(type, storey) * share,
    storey - style.sill - WINDOW_ROWS.lintel
  );
  const axis = t.axis * toward(r.axis / t.axis, TOWARD_TYPE.axis);
  const w = Math.min(
    t.w * toward(r.w / t.w, TOWARD_TYPE.w),
    axis - WINDOW_ROWS.gap
  );
  if (h < WINDOW_ROWS.min || w < WINDOW_ROWS.min) {
    return NO_WINDOWS;
  }
  return {
    axis: Math.round(axis * 100) / 100,
    w: Math.round(w * 100) / 100,
    h: Math.round(h * 100) / 100,
    style: packStyle(style),
  };
}

/**
 * How much higher a ground floor's windows start than the upper floors'
 * over their storey line (m, rounded up to `WINDOW_LIFT`'s class): a
 * Hochparterre's `WINDOW_ROWS.raise`, and their opening
 * `WINDOW_ROWS.plinthGap` over the plinth's top (`plinth`, over the
 * base) — a plinth stepping up a slope lifts them over its highest piece.
 * Undefined past the classes: that ground floor gets none.
 */
export function groundLift(
  raised: boolean,
  sill: number,
  plinth?: number
): number | undefined {
  const need = Math.max(
    raised ? WINDOW_ROWS.raise : 0,
    plinth === undefined ? 0 : plinth + WINDOW_ROWS.plinthGap - sill
  );
  const k = Math.max(0, Math.ceil(need / WINDOW_LIFT.step - 1e-6));
  return k < WINDOW_LIFT.classes ? k * WINDOW_LIFT.step : undefined;
}

/** Why a host carries no windows at all, or null where it may: a facade
 *  of its own carries a palace's (`WindowHost.palace`). */
function barred(h: WindowHost): NoWindows | null {
  if (!h.lod2) {
    return "beyond";
  }
  if (h.ownFacade && !(h.palace ?? false)) {
    return "facade";
  }
  if (h.eaveH < MIN_EAVE_M) {
    return "low";
  }
  return windowless(h.fn) ? "use" : null;
}

/** Where a host's rhythm comes from, best first (see the module). */
function rhythmOf(
  host: WindowHost,
  mine: FacadeModel | undefined,
  tree: FacadeModel | undefined,
  donors: readonly { host: WindowHost; m: FacadeModel }[]
): { from: WindowSource; m?: FacadeModel } {
  if (mine) {
    return { from: "measured", m: mine };
  }
  if (tree) {
    return { from: "tree", m: tree };
  }
  const near = nearestModel(host, donors);
  return near ? { from: "near", m: near } : { from: "type" };
}

/**
 * Every object's windows and storey (see the module): `hosts` in the
 * object table's order, `walls` the tile's measured walls, `index` an
 * object's row by its id.
 */
export function windowSpecs(
  hosts: readonly WindowHost[],
  walls: readonly WindowWall[],
  index: ReadonlyMap<string, number>
): WindowChoice[] {
  const own = measuredModels(walls, index);
  const byRoot = new Map<number, FacadeModel>();
  for (const [i, m] of own) {
    byRoot.set(hosts[i].root, byRoot.get(hosts[i].root) ?? m);
  }
  const donors = [...own].map(([i, m]) => ({ host: hosts[i], m }));
  return hosts.map((host, i): WindowChoice => {
    const why = barred(host);
    if (why) {
      return { from: "none", spec: NO_WINDOWS, storey: host.storeyH, why };
    }
    const mine = own.get(i);
    // a palace takes its own walls' rhythm or its type's, never a town
    // house's nearby
    const { from, m } = host.palace
      ? { from: mine ? ("measured" as const) : ("type" as const), m: mine }
      : rhythmOf(host, mine, byRoot.get(host.root), donors);
    const { storey, kind, photos } = storeyAndType(host, mine);
    const { reach, spec } = overGround(host, storey, (plinth) => {
      const style = styleOf({ ...host, plinth }, kind, m, from);
      const type = TYPES[kind];
      const fit = fitted(
        m ?? { axis: type.axis, w: type.w },
        kind,
        style,
        storey
      );
      // a ground floor whose lifted windows would lie wider than tall: none
      if (fit.axis > 0 && !style.noGround && squat(fit, style.lift)) {
        fit.style = packStyle({ ...style, noGround: true });
      }
      return fit;
    });
    if (spec.axis <= 0) {
      return { from: "none", spec, storey, why: "small" };
    }
    const choice = { from, reach, spec, storey };
    return photos === undefined || storey === host.storeyH
      ? choice
      : { ...choice, storeyFromPhotos: true };
  });
}

/**
 * A host's windows (`fit`, given what its ground floor's must clear) over
 * the highest ground or plinth in front of its walls (`WindowHost.ground`,
 * `plinth`) that still leaves it a ground floor, and the height its
 * lowest windows clear (`reach`): a wall the ground or a plinth rises
 * higher in front of loses its own ground floor, the others keep theirs —
 * one steep wall no longer takes every wall's. Without a ground floor (a
 * shop's, or none left) the reach is the first floor's.
 */
function overGround(
  host: WindowHost,
  storey: number,
  fit: (plinth: number | undefined) => WindowSpec
): { reach: number; spec: WindowSpec } {
  const reachOf = (spec: WindowSpec) => {
    const s = unpackStyle(spec.style);
    const sill = s.noGround
      ? Math.max(storey, WINDOW_ROWS.firstLine) + s.sill
      : s.sill + s.lift;
    return sill - WINDOW_ROWS.plinthGap;
  };
  // the levels the ground floor might clear, highest first, to the lift's
  // step
  const levels = [
    ...new Set(
      [...(host.ground ?? []), host.plinth ?? Number.NEGATIVE_INFINITY]
        .filter((g) => g > 0 && g <= GROUND_REACH_M)
        .map((g) => Math.ceil(g / WINDOW_LIFT.step - 1e-6) * WINDOW_LIFT.step)
    ),
  ].sort((a, b) => b - a);
  for (const level of levels) {
    const spec = fit(level);
    if (spec.axis <= 0 || !unpackStyle(spec.style).noGround) {
      return { reach: reachOf(spec), spec };
    }
  }
  const spec = fit(undefined);
  return { reach: reachOf(spec), spec };
}

/** A host's storey and type: a palace's (`palaceStorey`), else the storey
 *  snapped to the eave — the photos' only on the building itself, and only
 *  where OSM counts none — and the type its roof and storey give. */
function storeyAndType(
  host: WindowHost,
  mine: FacadeModel | undefined
): { kind: WindowType; photos?: number; storey: number } {
  if (host.palace) {
    return { kind: "palace", storey: palaceStorey(host.eaveH, host.storeys) };
  }
  const photos = mine && !host.levels ? mine.storey : undefined;
  const storey = windowStorey(host.eaveH, host.storeyH, photos);
  return {
    kind: windowType(host.flat, host.eaveH, storey, host.town ?? false),
    photos,
    storey,
  };
}

/** A host's window style: its type's reveal and sill, the photos' grid,
 *  Fasche and ornament where they saw them — the type's Fasche on a
 *  rendered front only, never on brick —, its ground floor's lift over
 *  the plinth (no ground floor over a shop or past the lift's classes). */
function styleOf(
  host: WindowHost,
  kind: WindowType,
  m: FacadeModel | undefined,
  from: WindowSource
): WindowStyle {
  const type = TYPES[kind];
  const lift = groundLift(type.raised ?? false, type.sill, host.plinth);
  return {
    depth: type.depth,
    sill: type.sill,
    loose: m ? m.grid === "loose" : (type.loose ?? false),
    lintel: m?.orn ?? false,
    frame:
      (m?.frame ?? false) || ((type.frame ?? false) && !(host.brick ?? false)),
    noGround: host.shop || lift === undefined,
    lift: lift ?? 0,
    measured: from === "measured" || from === "tree",
    near: from === "near",
  };
}

/** Whether a ground floor's windows, `lift` higher, would lie wider than
 *  tall. */
const squat = (spec: WindowSpec, lift: number) =>
  spec.h - lift < WINDOW_ROWS.squat * spec.w;

// --- the layout, as the shader draws it ------------------------------------

/** The width (m) of a door slot's width class (`DOOR_SLOT`). */
export function doorClassWidth(c: number): number {
  const { fine, w0, wideStep, wStep } = DOOR_SLOT;
  return w0 + wStep * Math.min(c, fine) + wideStep * Math.max(c - fine, 0);
}

/** A door's code in a `_FACADE` door slot (`DOOR_SLOT`): `at` m along the
 *  wall from its middle, `w` m wide. */
export function doorSlot(at: number, w: number): number {
  const { fine, reach, step, w0, wideStep, widths, wStep } = DOOR_SLOT;
  const place = Math.round(Math.min(Math.max(at, -reach), reach) / step);
  const top = w0 + fine * wStep;
  const width =
    w <= top + 1e-6
      ? Math.max(Math.ceil((w - w0) / wStep - 1e-6), 0)
      : Math.min(fine + Math.ceil((w - top) / wideStep - 1e-6), widths - 1);
  return place * widths + width;
}

/** The door a `_FACADE` door slot holds, as the shader reads it: its place
 *  along the wall from the middle and its width (m); none for `NO_DOOR`
 *  and the roof's flag. */
export function slotDoor(code: number): { at: number; w: number } | undefined {
  if (Math.abs(code) >= DOOR_NONE_CODE) {
    return undefined;
  }
  const { step, widths } = DOOR_SLOT;
  const place = Math.floor((code + 0.5) / widths);
  return { at: place * step, w: doorClassWidth(code - place * widths) };
}

/** Whether a ground-floor window `w` wide on the axis `axis` (m along the
 *  wall from its middle) keeps `DOOR_GAP_M` of wall from the opening of a
 *  door as a slot holds it — and half a place step more, as far as the
 *  door's rounded place may lie off its own. The shader's test
 *  (clay-windows.ts). */
export function clearOfDoor(
  axis: number,
  w: number,
  door: { at: number; w: number }
): boolean {
  return (
    Math.abs(axis - door.at) >=
    door.w / 2 + DOOR_GAP_M + DOOR_SLOT.step / 2 + w / 2
  );
}

// --- where on the walls -----------------------------------------------------

/** Two triangles of one wall: normals this close (cos), planes this
 *  close (m). */
const WALL_COS = 0.9998;
const WALL_PLANE_M = 0.02;
/** A triangle this upright is a wall (|n.z| of its unit normal). */
const UPRIGHT = 0.1;
/** A wall stands against another, back to back: normals opposed this well
 *  (cos), planes this close (m); covered over this share of it, it is a
 *  party wall. */
const PARTY_COS = -0.985;
const PARTY_PLANE_M = 0.5;
const PARTY_SHARE = 0.25;
/** A party wall of a house with at most this much wall (m, its eave over
 *  its base) is a facade again above its neighbour's top, where one more
 *  row of windows fits (`PARTY_CLEAR_M`): the upper floor of a house beside
 *  a lower one. A taller house's stays blank — the Brandwand of a block
 *  standing over its lower neighbour. */
export const PARTY_LOW_EAVE_M = 9;
const PARTY_CLEAR_M = 2;
/** A wall's end: its vertices this close to its extent's end (m). */
const WALL_END_M = 0.05;
/** A door or shopfront is on a wall: normals this close (cos), the wall's
 *  plane this close (m), along it with this slack (m). */
const ON_WALL_COS = 0.9;
const ON_WALL_M = 0.8;
const ON_WALL_SLACK_M = 0.3;

/** One wall: an object's edge-connected triangles in one plane. */
interface Wall {
  /** the plane's offset along `n` (m) */
  d: number;
  /** the doors on it: where along it (as `s0`, `s1`) and how wide (m) */
  doors: { s: number; w: number }[];
  /** horizontal unit normal, out of the building (data frame) */
  n: [number, number];
  object: number;
  /** the share of it another wall covers, back to back */
  party: number;
  /** the highest top (absolute m) of the walls covering it back to back */
  cover: number;
  /** extent along `t = (n.y, −n.x)` and up */
  s0: number;
  s1: number;
  /** how high the ground in front of it rises over its object's base (m),
   *  where it is known */
  ground: number;
  shop: boolean;
  /** where its measured axes stand (`FacadeAxes`): one axis' place along
   *  it (as `s0`, `s1`), its measured spacing and its object's window
   *  width */
  axes?: { at: number; axis: number; w: number };
  /** its eave (absolute m): the lower of its two ends' tops — a gable
   *  wall's eave corners, a wall under a roof sloping along it its lower
   *  end (`wallTop`) */
  top: number;
  tris: number[];
  z0: number;
  z1: number;
}

/** A door on an object's wall (data frame), its outward normal and its
 *  width (m). */
export interface FacadeDoor {
  at: [number, number];
  n: [number, number];
  object: number;
  w: number;
}

/** A measured wall's window axes (data frame): the footprint wall `a` →
 *  `b` with its outward normal, one axis `phase` metres from `a`, the
 *  wall's measured spacing and the window's width its object draws. */
export interface FacadeAxes {
  a: [number, number];
  axis: number;
  b: [number, number];
  n: [number, number];
  object: number;
  phase: number;
  w: number;
}

/** A shopfront on an object's wall (data frame), its outward normal. */
export interface FacadeShop {
  a: [number, number];
  b: [number, number];
  /** how high the ground (or plinth) along it stands over the object's
   *  base (m): where it buries the ground floor */
  ground?: number;
  n: [number, number];
  object: number;
}

/** The mesh's vertex stream as the facade reads it. */
export interface FacadeMesh {
  isRoof: ArrayLike<number>;
  objectIds: ArrayLike<number>;
  positions: ArrayLike<number>;
  /** a roof vertex's own face colour (linear RGB, 3 a vertex; NaN: its
   *  object's), for the stream's first vertices */
  roofRgb?: ArrayLike<number>;
}

/** A triangle's horizontal unit normal and plane offset, or undefined
 *  when it is no wall. */
function wallPlane(
  p: ArrayLike<number>,
  t: number
): { d: number; n: [number, number] } | undefined {
  const at = (i: number, c: number) => p[3 * (t + i) + c];
  const e1 = [at(1, 0) - at(0, 0), at(1, 1) - at(0, 1), at(1, 2) - at(0, 2)];
  const e2 = [at(2, 0) - at(0, 0), at(2, 1) - at(0, 1), at(2, 2) - at(0, 2)];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  const len = Math.hypot(nx, ny, nz);
  const lh = Math.hypot(nx, ny);
  if (len < 1e-6 || Math.abs(nz) > UPRIGHT * len) {
    return undefined;
  }
  const n: [number, number] = [nx / lh, ny / lh];
  return { n, d: n[0] * at(0, 0) + n[1] * at(0, 1) };
}

/** Union-find over `count` items. */
function unionFind(count: number) {
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  return {
    find,
    union: (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) {
        parent[rb] = ra;
      }
    },
  };
}

/** The wall triangles of the objects `drawn` says carry windows (each
 *  one's first vertex) and their planes. */
function wallTriangles(
  mesh: FacadeMesh,
  drawn: (object: number) => boolean
): { planes: { d: number; n: [number, number] }[]; tris: number[] } {
  const tris: number[] = [];
  const planes: { d: number; n: [number, number] }[] = [];
  for (let t = 0; t + 2 < mesh.objectIds.length; t += 3) {
    if (mesh.isRoof[t] === 1 || !drawn(mesh.objectIds[t])) {
      continue;
    }
    const plane = wallPlane(mesh.positions, t);
    if (plane) {
      tris.push(t);
      planes.push(plane);
    }
  }
  return { planes, tris };
}

/** The walls of the objects `drawn` says carry windows. */
function wallsOf(mesh: FacadeMesh, drawn: (object: number) => boolean): Wall[] {
  const p = mesh.positions;
  const { planes, tris } = wallTriangles(mesh, drawn);
  const uf = unionFind(tris.length);
  const byVertex = new Map<string, number[]>();
  const mm = (x: number) => Math.round(x * 1000);
  tris.forEach((t, k) => {
    for (let c = 0; c < 3; c++) {
      const i = 3 * (t + c);
      const key = `${mesh.objectIds[t]}:${mm(p[i])},${mm(p[i + 1])},${mm(p[i + 2])}`;
      const list = byVertex.get(key);
      if (!list) {
        byVertex.set(key, [k]);
        continue;
      }
      const a = planes[k];
      for (const other of list) {
        const b = planes[other];
        if (
          a.n[0] * b.n[0] + a.n[1] * b.n[1] >= WALL_COS &&
          Math.abs(a.d - b.d) <= WALL_PLANE_M
        ) {
          uf.union(other, k);
        }
      }
      list.push(k);
    }
  });
  const groups = new Map<number, Wall>();
  tris.forEach((t, k) => {
    const root = uf.find(k);
    let w = groups.get(root);
    if (!w) {
      w = {
        ...planes[root],
        object: mesh.objectIds[t],
        s0: Number.POSITIVE_INFINITY,
        s1: Number.NEGATIVE_INFINITY,
        z0: Number.POSITIVE_INFINITY,
        z1: Number.NEGATIVE_INFINITY,
        tris: [],
        doors: [],
        party: 0,
        cover: Number.NEGATIVE_INFINITY,
        ground: Number.NEGATIVE_INFINITY,
        shop: false,
        top: Number.NEGATIVE_INFINITY,
      };
      groups.set(root, w);
    }
    w.tris.push(t);
    for (let c = 0; c < 3; c++) {
      const i = 3 * (t + c);
      const s = p[i] * w.n[1] - p[i + 1] * w.n[0];
      w.s0 = Math.min(w.s0, s);
      w.s1 = Math.max(w.s1, s);
      w.z0 = Math.min(w.z0, p[i + 2]);
      w.z1 = Math.max(w.z1, p[i + 2]);
    }
  });
  const walls = [...groups.values()];
  for (const w of walls) {
    w.top = wallTop(w, p);
  }
  return walls;
}

/**
 * A wall's eave (absolute m): the lower of its two ends' tops. A gable
 * wall's ends are its eave corners, a wall under a roof that slopes along
 * it ends low on one side; a wall that rises to a higher roof of its
 * object (a front block over its rear wing, one LoD2 object in Hamburg and
 * München) has its own, above the object's lowest roof point.
 */
function wallTop(w: Wall, p: ArrayLike<number>): number {
  let top0 = Number.NEGATIVE_INFINITY;
  let top1 = Number.NEGATIVE_INFINITY;
  for (const t of w.tris) {
    for (let c = 0; c < 3; c++) {
      const i = 3 * (t + c);
      const s = p[i] * w.n[1] - p[i + 1] * w.n[0];
      if (s <= w.s0 + WALL_END_M) {
        top0 = Math.max(top0, p[i + 2]);
      }
      if (s >= w.s1 - WALL_END_M) {
        top1 = Math.max(top1, p[i + 2]);
      }
    }
  }
  return Math.min(top0, top1);
}

/** A point on a wall's line at `s` along it. */
const onLine = (w: Wall, s: number): [number, number] => [
  w.n[0] * w.d + w.n[1] * s,
  w.n[1] * w.d - w.n[0] * s,
];

/** The grid cells (8 m) a wall's line passes. */
function cellsOf(w: Wall): Set<string> {
  const CELL = 8;
  const out = new Set<string>();
  const steps = Math.max(1, Math.ceil((w.s1 - w.s0) / (CELL / 2)));
  for (let k = 0; k <= steps; k++) {
    const [x, y] = onLine(w, w.s0 + ((w.s1 - w.s0) * k) / steps);
    out.add(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
  }
  return out;
}

/** The area of `w` that `o` covers standing back to back against it. */
function coveredBy(w: Wall, o: Wall): number {
  if (
    w.n[0] * o.n[0] + w.n[1] * o.n[1] > PARTY_COS ||
    Math.abs(w.d + o.d) > PARTY_PLANE_M
  ) {
    return 0;
  }
  // the other's extent along this wall (its t runs the other way)
  const along = Math.min(w.s1, -o.s0) - Math.max(w.s0, -o.s1);
  const up = Math.min(w.z1, o.z1) - Math.max(w.z0, o.z0);
  return along > 0 && up > 0 ? along * up : 0;
}

/** Marks each wall's share another covers, back to back (`party`), and the
 *  highest top among those that do (`cover`). */
function markParty(walls: readonly Wall[]): void {
  const cells = walls.map(cellsOf);
  const grid = new Map<string, number[]>();
  cells.forEach((cs, i) => {
    for (const c of cs) {
      const list = grid.get(c);
      if (list) {
        list.push(i);
      } else {
        grid.set(c, [i]);
      }
    }
  });
  walls.forEach((w, i) => {
    const seen = new Set<number>([i]);
    let covered = 0;
    for (const c of cells[i]) {
      for (const j of grid.get(c) ?? []) {
        if (!seen.has(j)) {
          seen.add(j);
          const by = coveredBy(w, walls[j]);
          covered += by;
          if (by > 0) {
            w.cover = Math.max(w.cover, walls[j].z1);
          }
        }
      }
    }
    const area = (w.s1 - w.s0) * (w.z1 - w.z0);
    w.party = area > 0 ? covered / area : 0;
  });
}

/** The walls of one object facing `n` whose plane lies within
 *  `ON_WALL_M` of `p`, with `p`'s place along each. */
function wallsAt(
  byObject: ReadonlyMap<number, Wall[]>,
  object: number,
  p: [number, number],
  n: [number, number]
): { s: number; w: Wall }[] {
  return (byObject.get(object) ?? []).flatMap((w) => {
    const s = p[0] * w.n[1] - p[1] * w.n[0];
    return w.n[0] * n[0] + w.n[1] * n[1] >= ON_WALL_COS &&
      Math.abs(w.n[0] * p[0] + w.n[1] * p[1] - w.d) <= ON_WALL_M &&
      s >= w.s0 - ON_WALL_SLACK_M &&
      s <= w.s1 + ON_WALL_SLACK_M
      ? [{ s, w }]
      : [];
  });
}

/** How far out of its wall the ground in front of it is read (m): clear of
 *  the TIN's breakline at the wall's foot. */
const FRONT_M = 0.5;
/** The ground along a wall's foot is read this often (m). */
const FOOT_STEP_M = 2;
/** The ground counts in front of a wall triangle where it reaches up to at
 *  most this far under the triangle's lowest vertex (m): further down it
 *  lies under a lower roof of the building, not against the wall. */
const REACH_M = 1;

/**
 * How far the ground in front of each wall triangle rises over its
 * object's base (m), indexed by its first vertex over 3; NaN where it is
 * no wall or `groundAt` knows no ground there. The ground is read
 * `FRONT_M` out of the wall, every `FOOT_STEP_M` along the triangle's
 * stretch, and the highest reading counts: the windows sink wherever it
 * passes them. Every wall triangle is read, not only those at its
 * object's foot: a wall standing on a step of its building (the
 * Kunstakademie's wing on the terrace) meets the ground higher up; a
 * reading more than `REACH_M` under the triangle is the ground under a
 * lower roof and does not count.
 * `groundAt` in the mesh's frame.
 */
export function wallRises(
  mesh: FacadeMesh,
  baseOf: (object: number) => number | undefined,
  groundAt: (x: number, y: number) => number | null
): Float32Array {
  const p = mesh.positions;
  const out = new Float32Array(mesh.objectIds.length / 3).fill(Number.NaN);
  for (let t = 0; t + 2 < mesh.objectIds.length; t += 3) {
    const base = baseOf(mesh.objectIds[t]);
    const plane = mesh.isRoof[t] === 1 ? undefined : wallPlane(p, t);
    const z0 = Math.min(p[3 * t + 2], p[3 * t + 5], p[3 * t + 8]);
    if (base === undefined || !plane) {
      continue;
    }
    const { n, d } = plane;
    const s = [0, 1, 2].map(
      (k) => p[3 * (t + k)] * n[1] - p[3 * (t + k) + 1] * n[0]
    );
    const s0 = Math.min(...s);
    const s1 = Math.max(...s);
    const steps = Math.max(1, Math.ceil((s1 - s0) / FOOT_STEP_M));
    let rise = Number.NaN;
    for (let k = 0; k <= steps; k++) {
      const at = s0 + ((s1 - s0) * k) / steps;
      const g = groundAt(
        n[0] * (d + FRONT_M) + n[1] * at,
        n[1] * (d + FRONT_M) - n[0] * at
      );
      // a reading under the wall's foot is the ground under a lower roof
      if (g !== null && g >= z0 - REACH_M && !(g - base <= rise)) {
        rise = g - base;
      }
    }
    out[t / 3] = rise;
  }
  return out;
}

/** Metres to the attribute's snorm16 (`FACADE_SCALE_M` a unit). */
const snorm = (m: number) =>
  Math.round(Math.min(Math.max(m / FACADE_SCALE_M, -1), 1) * 32_767);
const NO_DOOR_SNORM = Math.round(NO_DOOR * 32_767);
const ROOF_SNORM = Math.round(FACADE_ROOF * 32_767);

/** A roof vertex's wall slots (x, y and the second door, w) hold its
 *  face's own colour, linear RGB a unit each; (0, 0, ·, 0) where it takes
 *  its object's. No window reads a roof vertex's slots (the clay masks
 *  them), so the colour costs no vertex buffer. */
function roofColourAt(
  out: Int16Array,
  v: number,
  rgb: ArrayLike<number> | undefined
): void {
  const r = rgb?.[3 * v];
  if (rgb === undefined || r === undefined || Number.isNaN(r)) {
    return;
  }
  const unit = (c: number) => Math.round(Math.min(Math.max(c, 0), 1) * 32_767);
  // never all zero: that reads as "the object's"
  out[4 * v] = Math.max(1, unit(r));
  out[4 * v + 1] = unit(rgb[3 * v + 1]);
  out[4 * v + 3] = unit(rgb[3 * v + 2]);
}

/** Lays the doors and shopfronts onto their objects' walls. */
function placeOnWalls(
  walls: readonly Wall[],
  doors: readonly FacadeDoor[],
  shops: readonly FacadeShop[],
  axes: readonly FacadeAxes[] = []
): void {
  const byObject = new Map<number, Wall[]>();
  for (const w of walls) {
    const list = byObject.get(w.object);
    if (list) {
      list.push(w);
    } else {
      byObject.set(w.object, [w]);
    }
  }
  for (const door of doors) {
    for (const { s, w } of wallsAt(byObject, door.object, door.at, door.n)) {
      w.doors.push({ s, w: door.w });
    }
  }
  for (const shop of shops) {
    const mid: [number, number] = [
      (shop.a[0] + shop.b[0]) / 2,
      (shop.a[1] + shop.b[1]) / 2,
    ];
    for (const { w } of wallsAt(byObject, shop.object, mid, shop.n)) {
      w.shop = true;
      w.ground = Math.max(w.ground, shop.ground ?? Number.NEGATIVE_INFINITY);
    }
  }
  for (const m of axes) {
    const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]);
    if (len <= 0) {
      continue;
    }
    const k = m.phase / len;
    const at: [number, number] = [
      m.a[0] + (m.b[0] - m.a[0]) * k,
      m.a[1] + (m.b[1] - m.a[1]) * k,
    ];
    // the lattice runs on along the footprint wall: every mesh wall in its
    // plane that overlaps it keeps it (a facade of several LoD2 polygons)
    for (const w of byObject.get(m.object) ?? []) {
      const sOf = (q: readonly [number, number]) =>
        q[0] * w.n[1] - q[1] * w.n[0];
      const [sa, sb] = [sOf(m.a), sOf(m.b)];
      if (
        w.n[0] * m.n[0] + w.n[1] * m.n[1] >= ON_WALL_COS &&
        Math.abs(w.n[0] * at[0] + w.n[1] * at[1] - w.d) <= ON_WALL_M &&
        Math.min(w.s1, Math.max(sa, sb)) - Math.max(w.s0, Math.min(sa, sb)) > 0
      ) {
        w.axes = { at: sOf(at), axis: m.axis, w: m.w };
      }
    }
  }
}

/** The measured walls whose axes stand where the photos saw them
 *  (`FacadeModel.phase`), at their own spacing (within `MEASURED_AXES`'
 *  range), on an object that draws windows, in the mesh's data frame
 *  (`cx`, `cy` off the CRS). */
export function measuredAxes(
  walls: readonly WindowWall[],
  index: ReadonlyMap<string, number>,
  specOf: (object: number) => WindowSpec | undefined,
  offset: { cx: number; cy: number }
): FacadeAxes[] {
  return walls.flatMap((w) => {
    const object = index.get(w.oid);
    const m = w.model;
    const spec = object === undefined ? undefined : specOf(object);
    if (
      object === undefined ||
      m?.phase === undefined ||
      !spec ||
      spec.axis <= 0 ||
      m.axis < MEASURED_AXES.axis0 ||
      m.axis > MEASURED_AXIS_MAX_M
    ) {
      return [];
    }
    return [
      {
        a: [w.a[0] - offset.cx, w.a[1] - offset.cy],
        axis: m.axis,
        b: [w.b[0] - offset.cx, w.b[1] - offset.cy],
        n: w.n,
        object,
        phase: m.phase,
        w: Math.min(spec.w, m.axis - WINDOW_ROWS.gap),
      },
    ];
  });
}

/** Where a wall's windows stand when its axes were measured: the middle
 *  of the measured lattice's axes that fit on it (`WINDOW_ROWS.edge` in
 *  from its ends) and how many they are; undefined where none fits or
 *  more than `MEASURED_AXES.maxN`. */
export function measuredColumns(
  s0: number,
  s1: number,
  axes: { at: number; axis: number; w: number }
): { axis: number; c: number; n: number } | undefined {
  const { at, axis, w } = axes;
  if (axis <= 0) {
    return undefined;
  }
  const lo = s0 + WINDOW_ROWS.edge + w / 2;
  const hi = s1 - WINDOW_ROWS.edge - w / 2;
  const first = Math.ceil((lo - at) / axis - 1e-6);
  const last = Math.floor((hi - at) / axis + 1e-6);
  const n = last - first + 1;
  if (n < 1 || n > MEASURED_AXES.maxN) {
    return undefined;
  }
  return { axis, c: at + ((first + last) / 2) * axis, n };
}

/** A measured wall's length slot (`MEASURED_AXES`, snorm16 units). */
export function measuredSlot(n: number, axis: number): number {
  const { axis0, base, perN, step } = MEASURED_AXES;
  const k = Math.min(Math.max(Math.round((axis - axis0) / step), 0), perN - 1);
  return base + n * perN + k;
}

/** The axes a length slot holds, as the shader reads it (`clay-windows.ts`
 *  `columns`): undefined on a wall that holds its length. */
export function slotAxes(
  units: number
): { axis: number; n: number } | undefined {
  const { axis0, base, perN, step } = MEASURED_AXES;
  const code = Math.abs(units) - base;
  if (code < 0) {
    return undefined;
  }
  const n = Math.floor(code / perN);
  return { axis: axis0 + (code - n * perN) * step, n };
}

/** What `facadeAttribute` reads of the objects' heights. */
export interface FacadeHeights {
  /** a LoD2 object's base and eave (absolute m; undefined for anything
   *  else): its walls then carry their own eave (`WALL_EAVE`), and a low
   *  house's party wall its windows over the neighbour's top
   *  (`PARTY_LOW_EAVE_M`) */
  of: (object: number) => { base: number; eave: number } | undefined;
}

/**
 * The `_FACADE` attribute (4 × snorm16 per vertex, `FACADE_SCALE_M` metres
 * a unit): per wall vertex of an object `drawn` says carries windows its
 * place along the wall from the wall's middle, the wall's length (negative
 * where its ground floor has none — a shopfront stands on it, more doors
 * than the two slots hold, the ground rises past its windows, or it is a
 * low house's party wall that stands free above its neighbour; 0 on any
 * other party wall), and its doors, the nearest the middle first
 * (`doorSlot`, `NO_DOOR` for none; on a wall without ground-floor windows,
 * which has none to keep off them, the first slot is instead the height
 * over the base its windows clear — the ground in front, the neighbour's
 * top — 0 where it is not known); in the second slot, wherever no door
 * needs it, the wall's own eave (`WALL_EAVE`, `heights`), on the walls of
 * every LoD2 object, with windows or not; every roof vertex (r, g,
 * FACADE_ROOF, b), its face's own colour where `mesh.roofRgb` has one and
 * (0, 0, FACADE_ROOF, 0) where not; every other vertex (0, 0, NO_DOOR,
 * NO_DOOR). `doors` and `shops` in the mesh's data frame. A wall the ground
 * in front of rises past its object's `reach` somewhere (`rises.at`, from
 * `wallRises`; `WindowChoice.reach`) is signed as a shopfront's: it loses
 * its ground floor.
 */
export function facadeAttribute(
  mesh: FacadeMesh,
  drawn: (object: number) => boolean,
  doors: readonly FacadeDoor[] = [],
  shops: readonly FacadeShop[] = [],
  rises?: { at: ArrayLike<number>; reach: (object: number) => number },
  heights?: FacadeHeights,
  axes: readonly FacadeAxes[] = []
): Int16Array<ArrayBuffer> {
  const count = mesh.objectIds.length;
  const out = new Int16Array(4 * count);
  for (let v = 0; v < count; v++) {
    if (mesh.isRoof[v] === 1) {
      out[4 * v + 2] = ROOF_SNORM;
      roofColourAt(out, v, mesh.roofRgb);
    } else {
      out[4 * v + 2] = NO_DOOR_SNORM;
      out[4 * v + 3] = NO_DOOR_SNORM;
    }
  }
  const heightOf = heights?.of ?? (() => undefined);
  const walls = wallsOf(mesh, (o) => drawn(o) || heightOf(o) !== undefined);
  // party walls, doors and shopfronts among the walls that carry windows
  const windowed = walls.filter((w) => drawn(w.object));
  markParty(windowed);
  placeOnWalls(windowed, doors, shops, axes);
  if (rises) {
    for (const w of windowed) {
      for (const t of w.tris) {
        const rise = rises.at[t / 3];
        if (rise > w.ground) {
          w.ground = rise;
        }
      }
      w.shop ||= w.ground > rises.reach(w.object);
    }
  }
  const p = mesh.positions;
  for (const w of walls) {
    const h = heightOf(w.object);
    const eave = h ? wallEaveSlot(w.top - h.eave) : NO_DOOR_SNORM;
    const slots = drawn(w.object)
      ? wallSlots(w, eave, h)
      : { c: Number.NaN, length: 0, door0: NO_DOOR_SNORM, door1: eave };
    for (const t of w.tris) {
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        const s = p[3 * i] * w.n[1] - p[3 * i + 1] * w.n[0];
        out[4 * i] = Number.isNaN(slots.c) ? 0 : snorm(s - slots.c);
        out[4 * i + 1] = slots.length;
        out[4 * i + 2] = slots.door0;
        out[4 * i + 3] = slots.door1;
      }
    }
  }
  return out;
}

/** A windowed wall's middle and its `_FACADE` slots (see
 *  `facadeAttribute`); `eave` its own eave's code (`wallEaveSlot`). */
function wallSlots(
  w: Wall,
  eave: number,
  h: { base: number; eave: number } | undefined
): { c: number; length: number; door0: number; door1: number } {
  const measured = w.axes && measuredColumns(w.s0, w.s1, w.axes);
  const c = measured ? measured.c : (w.s0 + w.s1) / 2;
  const above = partyAbove(w, h);
  if (above !== undefined) {
    // a facade above its neighbour: no window under the neighbour's top
    w.shop = true;
    w.ground = Math.max(w.ground, above);
  }
  const party = w.party > PARTY_SHARE && above === undefined;
  // a measured wall holds its axes in the length slot (`MEASURED_AXES`)
  const length = party
    ? 0
    : measured
      ? measuredSlot(measured.n, measured.axis)
      : snorm(Math.min(w.s1 - w.s0, LENGTH_MAX_M));
  const [d0, d1] = w.doors
    .map((d) => ({ at: d.s - c, w: d.w }))
    .sort((a, b) => Math.abs(a.at) - Math.abs(b.at));
  const noGround = w.shop || w.doors.length > 2;
  return {
    c,
    length: noGround ? -length : length,
    // a wall without ground-floor windows has none to keep off its doors:
    // its first slot holds the height its windows clear
    door0: noGround
      ? snorm(Math.max(w.ground, 0))
      : d0 === undefined
        ? NO_DOOR_SNORM
        : doorSlot(d0.at, d0.w),
    // … and its second, like a wall's with at most one door, its eave
    door1: noGround || d1 === undefined ? eave : doorSlot(d1.at, d1.w),
  };
}

/** Where a low house's party wall is a facade again (m over its base):
 *  above the highest top of the walls against it, where one more row of
 *  windows fits under its own eave (`PARTY_LOW_EAVE_M`, `PARTY_CLEAR_M`);
 *  undefined on any other wall. */
function partyAbove(
  w: Wall,
  h: { base: number; eave: number } | undefined
): number | undefined {
  if (
    !h ||
    w.party <= PARTY_SHARE ||
    h.eave - h.base > PARTY_LOW_EAVE_M ||
    Math.max(w.top, h.eave) - w.cover < PARTY_CLEAR_M
  ) {
    return undefined;
  }
  return w.cover - h.base;
}
