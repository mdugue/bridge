/**
 * How the monument layer sizes and seats what pipeline/bake/monuments.py
 * writes: the basin levels over sloping ground, a jet's height, where the
 * jets around a sculpture stand, the smoothed surface of a measured
 * relief, and the markers of monuments nothing measured. Plain numbers in,
 * plain numbers out. No THREE, no DOM.
 */
import { SINK } from "./ground-join";
import type {
  FountainStyle,
  MonumentForm,
  MonumentKind,
  ReliefGrid,
} from "./features";
import type { Point2 } from "./polyline";

/** A fountain without an outline (a DLM point, an OSM node): its basin radius (m). */
export const POINT_BASIN_R = 2.2;
/** Rim height above the highest ground under the basin (m), per style. */
const RIM_H: Record<FountainStyle, number> = {
  basin: 0.35,
  pool: 0.2,
  splash: 0,
};
/** The water stands this far below the rim's top (m). */
const FREEBOARD = 0.08;
/** The rim's footing reaches this far below the lowest ground (m): on a slope
 *  the uphill side must not float. */
const FOOTING = 0.3;
/** Wet paving of a splash pad: just above the ground so it does not z-fight. */
const SPLASH_LIFT = 0.03;
const JET_MIN = 1.2;
const JET_MAX = 4.5;
const SPLASH_JET = 1;

export interface BasinLevels {
  /** bottom of the rim (world Y) */
  base: number;
  /** top of the rim; equals `water` for a splash pad (no rim) */
  rim: number;
  water: number;
}

/** The basin's levels from the ground under its outline (m, world Y). */
export function basinLevels(
  ground: readonly number[],
  style: FountainStyle
): BasinLevels | null {
  const valid = ground.filter((h) => Number.isFinite(h));
  if (valid.length === 0) {
    return null;
  }
  const low = Math.min(...valid);
  const high = Math.max(...valid);
  if (style === "splash") {
    const water = high + SPLASH_LIFT;
    return { base: low - FOOTING, rim: water, water };
  }
  const rim = high + RIM_H[style];
  return { base: low - FOOTING, rim, water: rim - FREEBOARD };
}

/** A jet's height (m): larger basins throw higher, pools stay still. */
export function jetHeight(areaM2: number, style: FountainStyle): number {
  if (style === "pool") {
    return 0;
  }
  if (style === "splash") {
    return SPLASH_JET;
  }
  const h = 0.3 * Math.sqrt(Math.max(areaM2, 0));
  return Math.min(Math.max(h, JET_MIN), JET_MAX);
}

/** Shoelace area (m²) of a ring (closed or not). */
export function ringArea(ring: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

/** The ring's vertex mean — the centre a figure and the jets gather round. */
export function ringCentre(ring: readonly Point2[]): Point2 {
  const open = openRing(ring);
  let x = 0;
  let y = 0;
  for (const [px, py] of open) {
    x += px;
    y += py;
  }
  return [x / open.length, y / open.length];
}

/** A GeoJSON ring without its closing duplicate vertex. */
export function openRing(ring: readonly Point2[]): Point2[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

/** Even-odd point-in-polygon test. */
export function insideRing(p: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Where the jets stand. A plain fountain has one in the middle; one with a
 * figure has four around it, at 45 % of the basin's equivalent radius, each
 * kept only when it lands on the water (an elongated or bent basin loses
 * the ones that would spray onto the paving).
 */
export function jetPlaces(
  centre: Point2,
  areaM2: number,
  figure: boolean,
  water: readonly Point2[] | null
): Point2[] {
  if (!figure) {
    return [centre];
  }
  const r = 0.45 * Math.sqrt(areaM2 / Math.PI);
  const around: Point2[] = [0, 1, 2, 3].map((k) => {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    return [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
  });
  return water ? around.filter((p) => insideRing(p, water)) : around;
}

/**
 * A monument nothing measured (too small for the 1 m surface model, or under
 * a tree) and nothing names the form of: an abstract marker in the scene's
 * clay — a rounded pillar for a statue, a low slab for a stone, a slender
 * shaft for a column. No figure pretends to know what stands there (m).
 */
export const MARKER_SHAPE: Record<
  Exclude<MonumentKind, "fountain">,
  { depth: number; height: number; width: number }
> = {
  statue: { width: 0.7, depth: 0.7, height: 2.2 },
  stone: { width: 0.9, depth: 0.32, height: 1 },
  column: { width: 0.5, depth: 0.5, height: 4.5 },
};

/** The three clay solids a marker is built of: a rounded pillar (a capsule
 *  stretched), a rounded block and a tapering four-sided needle. */
export type MarkerSolid = "block" | "needle" | "pillar";

/** One solid of a marker: its size (m) and how far above the ground its
 *  foot stands (`lift`, m). */
export interface MarkerPiece {
  depth: number;
  height: number;
  lift: number;
  solid: MarkerSolid;
  width: number;
}

/**
 * The markers of the forms OSM names (lib/city/features.ts `MonumentForm`),
 * still abstract and in clay — the parts every such monument has, at the
 * size such monuments have, never a figure: a statue is a body-sized
 * pillar on its pedestal, a bust a head-sized one on a slender plinth, a
 * free sculpture a broad mass without one, a stele an upright slab, a
 * memorial stone a low rounded block, an obelisk a needle on its base.
 */
const FORM_PIECES: Record<MonumentForm, readonly MarkerPiece[]> = {
  statue: [
    { solid: "block", width: 1.1, depth: 1.1, height: 1.6, lift: 0 },
    { solid: "pillar", width: 0.62, depth: 0.5, height: 1.9, lift: 1.6 },
  ],
  bust: [
    { solid: "block", width: 0.5, depth: 0.5, height: 1.35, lift: 0 },
    { solid: "pillar", width: 0.5, depth: 0.42, height: 0.7, lift: 1.35 },
  ],
  sculpture: [{ solid: "pillar", width: 1.1, depth: 0.85, height: 2, lift: 0 }],
  stele: [{ solid: "block", width: 0.75, depth: 0.25, height: 1.9, lift: 0 }],
  stone: [{ solid: "pillar", width: 1.3, depth: 0.9, height: 0.95, lift: 0 }],
  obelisk: [
    { solid: "block", width: 1.5, depth: 1.5, height: 0.7, lift: 0 },
    { solid: "needle", width: 0.85, depth: 0.85, height: 5.3, lift: 0.7 },
  ],
};

/** A tagged height scales a form by at most this much either way. */
const HEIGHT_SCALE: readonly [number, number] = [0.4, 3];

/**
 * The solids of a monument's marker: its form's, scaled to a tagged
 * height (whole, so a 13 m obelisk is a broad one too), else the plain
 * marker of its kind.
 */
export function markerPieces(
  kind: Exclude<MonumentKind, "fountain">,
  form?: MonumentForm,
  height?: number
): MarkerPiece[] {
  const pieces: readonly MarkerPiece[] = (form ? FORM_PIECES[form] : null) ?? [
    {
      ...MARKER_SHAPE[kind],
      lift: 0,
      solid: kind === "stone" ? "block" : "pillar",
    },
  ];
  const top = Math.max(...pieces.map((p) => p.lift + p.height));
  const k =
    height && height > 0
      ? Math.min(Math.max(height / top, HEIGHT_SCALE[0]), HEIGHT_SCALE[1])
      : 1;
  return pieces.map((p) => ({
    solid: p.solid,
    width: p.width * k,
    depth: p.depth * k,
    height: p.height * k,
    lift: p.lift * k,
  }));
}

/** Samples per metre of a smoothed relief (0.25 m). */
export const RELIEF_SUB = 4;
/** Below this the smoothed relief sinks under the ground (m), so its fringe
 *  does not lie on the paving as a film. */
const RELIEF_FLOOR = 0.08;
const RELIEF_SINK = -SINK.relief;

export interface ReliefSurface {
  /** heights above ground (m) at the samples, row-major from the north */
  heights: Float32Array;
  /** projected coordinates of sample (0, 0) — the north-west corner */
  north: number;
  west: number;
  cols: number;
  rows: number;
  /** sample spacing (m) */
  step: number;
}

/** The baked 1 m cell at (row, col), 0 outside the grid. */
function cellAt(r: ReliefGrid, row: number, col: number): number {
  if (row < 0 || col < 0 || row >= r.rows || col >= r.cols) {
    return 0;
  }
  return (r.dm[row * r.cols + col] ?? 0) / 10;
}

/** Bilinear between the cell centres at a point `dx`, `dy` metres east and
 *  south of the grid's north-west corner. */
function bilinear(r: ReliefGrid, dx: number, dy: number): number {
  const fx = dx - 0.5;
  const fy = dy - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const tx = fx - c0;
  const ty = fy - r0;
  const top = cellAt(r, r0, c0) * (1 - tx) + cellAt(r, r0, c0 + 1) * tx;
  const bottom =
    cellAt(r, r0 + 1, c0) * (1 - tx) + cellAt(r, r0 + 1, c0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** One [1, 2, 1] / 4 pass along rows (`dx` 1) or columns (`dx` = cols). */
function blurPass(
  src: Float32Array<ArrayBuffer>,
  cols: number,
  rows: number,
  alongRows: boolean
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(src.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const [a, b] = alongRows
        ? [c > 0 ? src[i - 1] : 0, c < cols - 1 ? src[i + 1] : 0]
        : [r > 0 ? src[i - cols] : 0, r < rows - 1 ? src[i + cols] : 0];
      out[i] = (a + 2 * src[i] + b) / 4;
    }
  }
  return out;
}

/**
 * The measured relief as a smooth surface: the 1 m cells interpolated to
 * `RELIEF_SUB` samples per metre and softened once with a small binomial
 * kernel, so the stair-stepped laser grid reads as one modelled form. The
 * fringe below `RELIEF_FLOOR` drops under the ground.
 */
export function reliefSurface(r: ReliefGrid): ReliefSurface {
  const step = 1 / RELIEF_SUB;
  const cols = r.cols * RELIEF_SUB + 1;
  const rows = r.rows * RELIEF_SUB + 1;
  let heights = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      heights[row * cols + col] = bilinear(r, col * step, row * step);
    }
  }
  for (let pass = 0; pass < 1; pass++) {
    heights = blurPass(heights, cols, rows, true);
    heights = blurPass(heights, cols, rows, false);
  }
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < RELIEF_FLOOR) {
      heights[i] = RELIEF_SINK;
    }
  }
  return { heights, north: r.north, west: r.west, cols, rows, step };
}

/**
 * Whether a projected point stands on a measured relief (a cell the bake
 * kept). The canopy bake reads the same DOM1 and plants a "tree" on any
 * tall enough texel in a park — a statue there included; where the DLM
 * names a monument and its body was measured, the monument wins.
 */
export function onRelief(
  reliefs: readonly ReliefGrid[],
  x: number,
  y: number
): boolean {
  for (const r of reliefs) {
    const col = Math.floor(x - r.west);
    const row = Math.floor(r.north - y);
    if (cellAt(r, row, col) > 0) {
      return true;
    }
  }
  return false;
}

/** A stable yaw (radians) from a position, so statues do not all face north
 *  and do not turn on reload. */
export function yawOf(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453;
  return (s - Math.floor(s)) * Math.PI * 2;
}

/**
 * A material's tone (sRGB), muted into the clay's palette: an abstraction
 * of what the eye takes from a monument at a distance — warm sandstone,
 * grey granite, bronze's dark green-brown patina, copper's verdigris, a
 * soft gold — never a texture. A material without one (glass, plastic,
 * ceramic: too varied to name a colour) stays in clay.
 */
export const MATERIAL_TONE: Readonly<Record<string, number>> = {
  Sandstein: 0xe2_cf_ac,
  Stein: 0xe3_de_d4,
  Kalkstein: 0xe8_e2_d3,
  Marmor: 0xf1_ee_e8,
  Granit: 0xb8_b5_b0,
  Diabas: 0x8f_91_8f,
  Porphyr: 0xc0_94_87,
  Beton: 0xcd_ca_c3,
  Ziegel: 0xc8_90_7a,
  Holz: 0xb9_9c_7c,
  Porzellan: 0xf4_f3_f0,
  Bronze: 0x7f_8c_6e,
  Kupfer: 0x86_b2_9d,
  Gold: 0xd8_b4_5a,
  Blattgold: 0xd8_b4_5a,
  Messing: 0xc9_ae_72,
  Metall: 0xa9_ae_b3,
  Stahl: 0xa9_ae_b3,
  Edelstahl: 0xb9_bd_c1,
  Eisen: 0x7d_80_84,
  Gusseisen: 0x7d_80_84,
};

/** What shows of a figure's materials, the most striking first: gilding
 *  over the copper under it, a metal over its stone. */
const FIGURE_ORDER = [
  "Blattgold",
  "Gold",
  "Kupfer",
  "Bronze",
  "Messing",
  "Edelstahl",
  "Stahl",
  "Metall",
  "Gusseisen",
  "Eisen",
];
/** What a pedestal is built of. */
const BASE_MATERIALS = new Set([
  "Sandstein",
  "Stein",
  "Kalkstein",
  "Marmor",
  "Granit",
  "Diabas",
  "Porphyr",
  "Beton",
  "Ziegel",
]);

/** The tones of a monument (sRGB): its figure's and its pedestal's;
 *  `null` where nothing names one (clay). */
export interface MarkerTones {
  base: number | null;
  figure: number | null;
}

/**
 * A monument's tones from its materials ("Bronze, Granit"): the figure
 * takes the most striking metal, else the first material named; the
 * pedestal the first stone named — else, where only metals are named,
 * clay (nothing says what it stands on), and where only one stone is,
 * that stone (a sandstone statue on its sandstone base).
 */
export function markerTones(material?: string): MarkerTones {
  const names = (material ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n in MATERIAL_TONE);
  if (names.length === 0) {
    return { base: null, figure: null };
  }
  const figure = FIGURE_ORDER.find((n) => names.includes(n)) ?? names[0];
  const base = names.find((n) => BASE_MATERIALS.has(n));
  return {
    figure: MATERIAL_TONE[figure],
    base: base ? MATERIAL_TONE[base] : null,
  };
}

/** A measured relief this tall (m) is a figure on a pedestal: its upper
 *  part takes the figure's tone, its lower the pedestal's. */
export const PEDESTAL_RELIEF_M = 3;
/** Where on such a relief the figure begins (a share of its height): the
 *  Goldener Reiter's pedestal ends at 4.6 of 8.5 m in the laser scan. */
export const FIGURE_FROM = 0.55;
/** The blend between pedestal and figure (m). */
const FIGURE_BLEND = 0.4;

/**
 * How much of the figure's tone a relief vertex takes (0 the pedestal's,
 * 1 the figure's) at `h` above the ground, on a relief `top` tall: a low
 * relief is all figure, a tall one a figure above `FIGURE_FROM` of its
 * height.
 */
export function figureShare(h: number, top: number): number {
  if (top < PEDESTAL_RELIEF_M) {
    return 1;
  }
  const t = (h - top * FIGURE_FROM) / FIGURE_BLEND + 0.5;
  return Math.min(Math.max(t, 0), 1);
}
