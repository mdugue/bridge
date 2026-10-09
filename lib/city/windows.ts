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
 *    form, an eave of about its height): a block's houses share their era,
 *  - its type (`TYPES`): a tall or a low storey under a pitched roof, a
 *    small house, a flat-roofed block or a low flat-roofed building.
 * None on a building whose facade is its own (a landmark, a church, a
 * hall: flag 16), on glass or metal cladding, on a garage, a shed, a
 * warehouse or a plant (`WINDOWLESS`), or on anything under 3.2 m of wall.
 * The storey height snaps to the eave (`windowStorey`), so the top row
 * sits under the Traufgesims on every house.
 *
 * **Where** is four numbers per wall vertex (`facadeAttribute`, the glTF's
 * `_FACADE`): metres along the wall from its middle, the wall's length
 * (negative over a shopfront: no window on its ground floor), and where up
 * to two of OSM's doors stand along it and how wide they are (no
 * ground-floor window within `DOOR_GAP_M` of one; a wall with more doors
 * has none on its ground floor). A wall is one plane of one object's
 * triangles, edge-connected; a party wall — one another wall stands
 * against, back to back — gets none.
 *
 * Positions along the wall are not measured (two drives' poses differ by
 * ~0.6 m), the rhythm is: the axes are centred on each wall. Pure, no DOM.
 */

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
 * A door slot of `_FACADE` (its third and fourth number) holds the snorm16
 * code `place · widths + class`: the door's place along the wall from the
 * wall's middle in `step` m, held to ±`reach` m (so no code comes near
 * ±32 767, the roof's flag and no door), and its width class, the door's
 * width rounded up to `w0 + class · wStep` m (0.6–2.8 m).
 */
export const DOOR_SLOT = {
  reach: 270,
  step: 0.1,
  w0: 0.6,
  widths: 12,
  wStep: 0.2,
} as const;
/** The codes from here on either side are no door (`NO_DOOR`,
 *  `FACADE_ROOF`). */
export const DOOR_NONE_CODE = 32_767;

/** Walls of at least this height carry windows (m, the object's eave). */
const MIN_EAVE_M = 3.2;

/** The building functions (ALKIS, `31001_…` prefixes) that have no
 *  windows to speak of: garden houses, kiosks, petrol stations and car
 *  washes, warehouses, shelters and vehicle halls, garages and parking,
 *  plants and utility buildings, barns, sheds, stables, greenhouses. */
const WINDOWLESS = [
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

/** Whether a building function has no windows (`WINDOWLESS`). */
export function windowless(fn: string | undefined): boolean {
  return fn !== undefined && WINDOWLESS.some((p) => fn.startsWith(p));
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
export type WindowType = "block" | "house" | "low" | "storey" | "tall";

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
};

/** A pitched-roof storey this tall is a town house's (m). */
const TALL_STOREY_M = 3.3;
/** At most this much wall is a house (m, the eave). */
const HOUSE_EAVE_M = 6.5;
/** A flat-roofed building from this eave is a block (m). */
const BLOCK_EAVE_M = 7;

/** A building's type from its roof, eave and storey. */
export function windowType(
  flat: boolean,
  eaveH: number,
  storeyH: number
): WindowType {
  if (flat) {
    return eaveH >= BLOCK_EAVE_M ? "block" : "low";
  }
  if (eaveH <= HOUSE_EAVE_M) {
    return "house";
  }
  return storeyH >= TALL_STOREY_M ? "tall" : "storey";
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
  /** how high its plinth stands over its base (m), where one is drawn:
   *  its ground floor's windows keep over it */
  plinth?: number;
  /** the root of its building tree */
  root: number;
  /** a shop on its ground floor (OSM) */
  shop: boolean;
  storeyH: number;
}

/** Where a building's rhythm came from. */
export type WindowSource = "measured" | "near" | "none" | "tree" | "type";

/** One building's windows and storey (`windowSpecs`). */
export interface WindowChoice {
  from: WindowSource;
  spec: WindowSpec;
  storey: number;
}

/** A measured building lends its rhythm this far (m, centre to centre). */
export const NEAR_M = 150;
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

/** Whether a host carries windows at all. */
function carries(h: WindowHost): boolean {
  return h.lod2 && !h.ownFacade && h.eaveH >= MIN_EAVE_M && !windowless(h.fn);
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
    if (!carries(host)) {
      return { from: "none", spec: NO_WINDOWS, storey: host.storeyH };
    }
    const mine = own.get(i);
    const { from, m } = rhythmOf(host, mine, byRoot.get(host.root), donors);
    // the photos' storey only on the building itself, and only where OSM
    // counts none
    const storey = windowStorey(
      host.eaveH,
      host.storeyH,
      mine && !host.levels ? mine.storey : undefined
    );
    const kind = windowType(host.flat, host.eaveH, storey);
    const style = styleOf(host, kind, m, from);
    const type = TYPES[kind];
    const spec = fitted(
      m ?? { axis: type.axis, w: type.w },
      kind,
      style,
      storey
    );
    // a ground floor whose lifted windows would lie wider than tall: none
    if (spec.axis > 0 && !style.noGround && squat(spec, style.lift)) {
      spec.style = packStyle({ ...style, noGround: true });
    }
    return { from: spec.axis > 0 ? from : "none", spec, storey };
  });
}

/** A host's window style: its type's reveal and sill, the photos' grid,
 *  Fasche and ornament where they saw them, its ground floor's lift over
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
    frame: (m?.frame ?? false) || (type.frame ?? false),
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

/**
 * The axes' centres along a wall of `length`, from its middle: at the
 * spacing, centred, `WINDOW_ROWS.edge` of wall at either end beside the
 * outer windows (before a loose grid's jitter, which the shader adds by a
 * hash). The shader's count and positions (clay-windows.ts).
 */
export function windowAxes(length: number, spec: WindowSpec): number[] {
  const room = length - 2 * WINDOW_ROWS.edge - spec.w;
  if (spec.axis <= 0 || room < 0) {
    return [];
  }
  const n = Math.floor(room / spec.axis + 1e-4) + 1;
  return Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * spec.axis);
}

/** A door's code in a `_FACADE` door slot (`DOOR_SLOT`): `at` m along the
 *  wall from its middle, `w` m wide. */
export function doorSlot(at: number, w: number): number {
  const { reach, step, w0, widths, wStep } = DOOR_SLOT;
  const place = Math.round(Math.min(Math.max(at, -reach), reach) / step);
  const width = Math.min(
    Math.max(Math.ceil((w - w0) / wStep - 1e-6), 0),
    widths - 1
  );
  return place * widths + width;
}

/** The door a `_FACADE` door slot holds, as the shader reads it: its place
 *  along the wall from the middle and its width (m); none for `NO_DOOR`
 *  and the roof's flag. */
export function slotDoor(code: number): { at: number; w: number } | undefined {
  if (Math.abs(code) >= DOOR_NONE_CODE) {
    return undefined;
  }
  const { step, w0, widths, wStep } = DOOR_SLOT;
  const place = Math.floor((code + 0.5) / widths);
  return { at: place * step, w: w0 + (code - place * widths) * wStep };
}

/** Whether a ground-floor window `w` wide on the axis `axis` (m along the
 *  wall from its middle) keeps `DOOR_GAP_M` of wall from a door's opening.
 *  The shader's test (clay-windows.ts). */
export function clearOfDoor(
  axis: number,
  w: number,
  door: { at: number; w: number }
): boolean {
  return Math.abs(axis - door.at) >= door.w / 2 + DOOR_GAP_M + w / 2;
}

/**
 * The window rows over an object's base (m): per storey the sill and the
 * head, the ground floor's from the base (lifted, `WindowStyle.lift`),
 * each upper one's from its storey line, every head at most
 * `eaveH − WINDOW_ROWS.eaveClear` (a top floor's windows a little shorter
 * where they must be, none where less than `min` is left); the ground
 * floor's only where `ground` is (no shop, no shopfront on the wall) and
 * where it fits under the first storey line. The shader's rows
 * (clay-windows.ts).
 */
export function windowRows(
  spec: WindowSpec,
  storeyH: number,
  eaveH: number,
  ground = true
): [number, number][] {
  if (spec.axis <= 0) {
    return [];
  }
  const { sill, noGround, lift } = unpackStyle(spec.style);
  const first = Math.max(storeyH, WINDOW_ROWS.firstLine);
  const h = Math.min(spec.h, storeyH - sill - WINDOW_ROWS.lintel);
  const top = eaveH - WINDOW_ROWS.eaveClear;
  const out: [number, number][] = [];
  const row = (z0: number, z1: number) => {
    const head = Math.min(z1, top);
    if (head - z0 >= WINDOW_ROWS.min - 1e-9) {
      out.push([z0, head]);
    }
  };
  if (ground && !noGround && sill + h <= first - WINDOW_ROWS.lintel + 1e-9) {
    row(sill + lift, sill + h);
  }
  for (
    let line = first;
    line + sill + WINDOW_ROWS.min <= top;
    line += storeyH
  ) {
    row(line + sill, line + sill + h);
  }
  return out;
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
  /** extent along `t = (n.y, −n.x)` and up */
  s0: number;
  s1: number;
  shop: boolean;
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

/** A shopfront on an object's wall (data frame), its outward normal. */
export interface FacadeShop {
  a: [number, number];
  b: [number, number];
  n: [number, number];
  object: number;
}

/** The mesh's vertex stream as the facade reads it. */
export interface FacadeMesh {
  isRoof: ArrayLike<number>;
  objectIds: ArrayLike<number>;
  positions: ArrayLike<number>;
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
        shop: false,
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
  return [...groups.values()];
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

/** Marks each wall's share another covers, back to back (`party`). */
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
          covered += coveredBy(w, walls[j]);
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

/** Metres to the attribute's snorm16 (`FACADE_SCALE_M` a unit). */
const snorm = (m: number) =>
  Math.round(Math.min(Math.max(m / FACADE_SCALE_M, -1), 1) * 32_767);
const NO_DOOR_SNORM = Math.round(NO_DOOR * 32_767);
const ROOF_SNORM = Math.round(FACADE_ROOF * 32_767);

/** Lays the doors and shopfronts onto their objects' walls. */
function placeOnWalls(
  walls: readonly Wall[],
  doors: readonly FacadeDoor[],
  shops: readonly FacadeShop[]
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
    }
  }
}

/**
 * The `_FACADE` attribute (4 × snorm16 per vertex): per wall vertex of an
 * object `drawn` says carries windows its place along the wall from the
 * wall's middle and the wall's length (`FACADE_SCALE_M` metres a unit; the
 * length negative where the ground floor has no windows — a shopfront
 * stands on it, or more doors than the two slots hold —, 0 on a party
 * wall), and its doors, the nearest the middle first (`doorSlot`, `NO_DOOR`
 * for none); every roof vertex (0, 0, FACADE_ROOF, NO_DOOR), every other
 * vertex (0, 0, NO_DOOR, NO_DOOR). `doors` and `shops` in the mesh's data
 * frame.
 */
export function facadeAttribute(
  mesh: FacadeMesh,
  drawn: (object: number) => boolean,
  doors: readonly FacadeDoor[] = [],
  shops: readonly FacadeShop[] = []
): Int16Array<ArrayBuffer> {
  const count = mesh.objectIds.length;
  const out = new Int16Array(4 * count);
  for (let v = 0; v < count; v++) {
    out[4 * v + 2] = mesh.isRoof[v] === 1 ? ROOF_SNORM : NO_DOOR_SNORM;
    out[4 * v + 3] = NO_DOOR_SNORM;
  }
  const walls = wallsOf(mesh, drawn);
  markParty(walls);
  placeOnWalls(walls, doors, shops);
  const p = mesh.positions;
  for (const w of walls) {
    const c = (w.s0 + w.s1) / 2;
    const length = w.party > PARTY_SHARE ? 0 : w.s1 - w.s0;
    const [d0, d1] = w.doors
      .map((d) => ({ at: d.s - c, w: d.w }))
      .sort((a, b) => Math.abs(a.at) - Math.abs(b.at));
    const noGround = w.shop || w.doors.length > 2;
    const lengthSnorm = snorm(noGround ? -length : length);
    const door0 = d0 === undefined ? NO_DOOR_SNORM : doorSlot(d0.at, d0.w);
    const door1 = d1 === undefined ? NO_DOOR_SNORM : doorSlot(d1.at, d1.w);
    for (const t of w.tris) {
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        const s = p[3 * i] * w.n[1] - p[3 * i + 1] * w.n[0];
        out[4 * i] = snorm(s - c);
        out[4 * i + 1] = lengthSnorm;
        out[4 * i + 2] = door0;
        out[4 * i + 3] = door1;
      }
    }
  }
  return out;
}
