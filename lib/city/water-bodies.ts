/**
 * The water's bodies as the land-cover bake leaves them in each tile's
 * legend (pipeline/bake/water.py: the legend's `water` member), and what
 * the build makes of them (scripts/prepare-data.ts):
 *
 * - the ground of every lifted fill raised to its body's level
 *   (`raiseWater`, a pass of scripts/bake-tiles.ts `shapeDgm`): Hamburg's
 *   Fleete, Oberhafen and the strip behind the Landungsbrücken' pontoons
 *   stood 1.8–2 m under the Elbe they open onto;
 * - each body's tint, its colour read on every tile it spans pooled
 *   (`siteWaterTints`: a river is one colour across the seams), and the
 *   foam lines, as the terrain extras' `water` (`waterLook`), which the
 *   water sheet reads (app/_components/water-layer.ts).
 */

import { decodeGreyPng } from "./png-raster";
import { isInvalidElevation, type TerrainBounds } from "./terrain-geometry";

/** A side of a tile. */
export type EdgeSide = "n" | "s" | "w" | "e";
/** A run of a body's cells along a tile's side: [from, to, z]. */
export type EdgeRun = [number, number, number?];

/** One body of water on one tile (water.py `body_rows`). */
export interface WaterBodyRow {
  /** a point in it (EPSG) */
  at: [number, number];
  /** how many open-water cells `lab` was read from */
  core?: number;
  /** where it meets the tile's edges: per side the runs [from, to, z] of
   *  1 m cells along it — from the west or the north, `to` exclusive, z the
   *  surface's median along the run (m) */
  edges?: Partial<Record<EdgeSide, EdgeRun[]>>;
  /** the median DOP colour of its open water, the flight's cast taken out
   *  (CIE L*a*b*, D65) */
  lab?: [number, number, number];
  /** the mode of its surface (m, 5 cm bins) */
  level: number;
  m2: number;
  /** its surface's 5th and 95th percentile (m) */
  range: [number, number];
}

/** Where the water falls (water.py `foam`): a weir, a cascade. */
export interface FoamLine {
  /** downstream, a unit vector in EPSG axes, where the DGM shows it */
  down?: [number, number];
  /** the drop (m) */
  drop: number;
  /** across the water, EPSG */
  line: [[number, number], [number, number]];
}

/** The legend's `water` member. */
export interface WaterMember {
  bodies: WaterBodyRow[];
  foam?: FoamLine[];
  /** the ground the terrain bake lifts (water.py `lift_raster`): a grey
   *  PNG over the DGM's grid (base64), each texel 0 or 1 + its level's
   *  index in `levels` (m) */
  lifts?: { levels: number[]; m2: number; png: string };
  /** the dry shore re-classed in the class raster (m²) */
  shore?: { bankM2: number; meadowM2: number; sandM2: number };
  /** which body's colour is where: n² cells over the tile (row 0 =
   *  north), base64, each 1 + the body's row in `bodies` */
  tint?: { cells: string; n: number };
}

/** The extras' `water` (TerrainExtras.water): what the sheet reads. */
export interface WaterLook {
  /** foam lines, data frame: [x0, y0, x1, y1, drop (m), downX, downY]
   *  (down 0, 0 where the DGM does not say) — the fine level only */
  foam?: number[][];
  /** n² cells over the tile (row 0 = north), base64, each 0 (the sheet's
   *  own colour) or 1 + an index into `colours` (sRGB 0xrrggbb) */
  tint?: { cells: string; colours: number[]; n: number };
}

/** Base64 → its bytes (the lifts' PNG, the tint grid's cells). */
export const fromBase64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Foam lines a tile carries at most (water.py FOAM_MAX; the sheet's
 *  uniform array). */
export const FOAM_LINES = 16;

// --- the lifts ------------------------------------------------------------------

/** A tile's lifts decoded: `index` n² (row 0 = north), each 0 or 1 + its
 *  level's index in `levels`. */
export interface WaterLift {
  bounds: TerrainBounds;
  index: Uint8Array;
  levels: number[];
  n: number;
}

/** The member's lifts over the tile's `bounds`, or null when it has none. */
export async function decodeLift(
  member: WaterMember | null | undefined,
  bounds: TerrainBounds
): Promise<WaterLift | null> {
  const lifts = member?.lifts;
  if (!lifts) {
    return null;
  }
  const png = await decodeGreyPng(fromBase64(lifts.png));
  return { bounds, index: png.data, levels: lifts.levels, n: png.width };
}

export interface WaterRaiseInput {
  bounds: TerrainBounds;
  elevations: ArrayLike<number>;
  lift: WaterLift;
  n: number;
}

/**
 * Every grid cell whose centre lies on a lifted cell raised to that cell's
 * level, in a COPY of the elevations — the fine level's native grid cell for
 * cell, a coarser one by its centre. Never lowers; NoData stays NoData.
 */
export function raiseWater(input: WaterRaiseInput): Float32Array {
  const { elevations, n, bounds, lift } = input;
  const out = Float32Array.from(elevations);
  const [minX, minY, maxX, maxY] = bounds;
  const [lx0, ly0, lx1, ly1] = lift.bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  const sx = lift.n / (lx1 - lx0);
  const sy = lift.n / (ly1 - ly0);
  for (let row = 0; row < n; row++) {
    const lr = Math.floor((ly1 - (maxY - (row + 0.5) * dy)) * sy);
    if (lr < 0 || lr >= lift.n) {
      continue;
    }
    for (let col = 0; col < n; col++) {
      const lc = Math.floor((minX + (col + 0.5) * dx - lx0) * sx);
      const k = lc >= 0 && lc < lift.n ? lift.index[lr * lift.n + lc] : 0;
      const idx = row * n + col;
      if (k > 0 && !isInvalidElevation(out[idx])) {
        out[idx] = Math.max(out[idx], lift.levels[k - 1]);
      }
    }
  }
  return out;
}

// --- the tint -------------------------------------------------------------------

/** The water sheet's own colour (water-layer.ts): the palette's dusty blue.
 *  A tint takes its lightness. */
export const WATER_SHEET = 0x7a_9e_bc;
/** A tint's chroma, as shares of the sheet's: a dark brown canal reads tan,
 *  not black, and no water is louder than the palette's. */
const TINT_CHROMA: [number, number] = [1, 1.3];
/** The measured chroma under which the water has no hue to read (grey,
 *  near-black water: the sheet's own colour), and over which its hue is
 *  fully its own. */
const TINT_GREY: [number, number] = [2, 6];
/** …and the lightness (L*) under which it reads no hue either: water this
 *  dark in the photo mirrors a dark sky (the Alster, Hamburg's Fleete at
 *  L* 6–10, their hues noise), over the second its hue holds. */
const TINT_DARK: [number, number] = [12, 20];
/** A hue this close to the sheet's (degrees, CIE LCh) is the sheet's: the
 *  palette was drawn from Saxony's rivers, and they keep it. Past the
 *  second, the water's own. */
const TINT_HUE: [number, number] = [15, 35];

type Lab = [number, number, number];
const WHITE = [0.950_47, 1, 1.088_83];

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
  return t * t * (3 - 2 * t);
};

/** 0xrrggbb sRGB → CIE L*a*b* (D65); water.py `_lab`. */
export function labOf(rgb: number): Lab {
  const lin = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255].map((v) => {
    const c = v / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const xyz = [
    0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2],
    0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2],
    0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2],
  ];
  const f = xyz.map((v, i) => {
    const t = v / WHITE[i];
    return t > 0.008_856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** CIE L*a*b* (D65) → 0xrrggbb sRGB, clipped. */
export function rgbOf(lab: Lab): number {
  const fy = (lab[0] + 16) / 116;
  const f = [fy + lab[1] / 500, fy, fy - lab[2] / 200];
  const [x, y, z] = f.map(
    (v, i) => (v > 0.206_893 ? v ** 3 : (v - 16 / 116) / 7.787) * WHITE[i]
  );
  const lin = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const [r, g, b] = lin.map((v) => {
    const c = Math.min(Math.max(v, 0), 1);
    const s = c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255);
  });
  return (r << 16) | (g << 8) | b;
}

/**
 * A body's tint from its measured colour: its hue (CIE LCh) at the sheet's
 * lightness, the chroma held between TINT_CHROMA of the sheet's — blended
 * back to the sheet's own colour where the water reads grey (TINT_GREY),
 * near-black (TINT_DARK) or the palette's hue already (TINT_HUE). The
 * Isar's glacial green, the Hamburg Elbe's ochre; Saxony's rivers keep the
 * palette's blue.
 */
export function waterTint(lab: Lab): number {
  const sheet = labOf(WATER_SHEET);
  const chroma = Math.hypot(lab[1], lab[2]);
  const own = Math.hypot(sheet[1], sheet[2]);
  const turn = Math.abs(
    ((Math.atan2(lab[2], lab[1]) - Math.atan2(sheet[2], sheet[1])) * 180) /
      Math.PI
  );
  const apart = Math.min(turn % 360, 360 - (turn % 360));
  const w =
    smooth(TINT_GREY[0], TINT_GREY[1], chroma) *
    smooth(TINT_DARK[0], TINT_DARK[1], lab[0]) *
    smooth(TINT_HUE[0], TINT_HUE[1], apart);
  if (w <= 0) {
    return WATER_SHEET;
  }
  const c = Math.min(
    Math.max(chroma, TINT_CHROMA[0] * own),
    TINT_CHROMA[1] * own
  );
  const k = c / chroma;
  return rgbOf([
    sheet[0],
    sheet[1] + (lab[1] * k - sheet[1]) * w,
    sheet[2] + (lab[2] * k - sheet[2]) * w,
  ]);
}

/** A tile's water, as the build reads it. */
export interface TileWater {
  bounds: TerrainBounds;
  id: string;
  member: WaterMember | null;
}

/** Two runs at a seam this far apart in height (m) are two waters: a lock
 *  or a weir stands on the seam (water.py STEP_M). */
const SEAM_STEP_M = 0.5;

type Runs = EdgeRun[] | undefined;

/** Whether two bodies' runs along a shared seam meet: they overlap, at one
 *  height where both say theirs. */
const overlaps = (a: Runs, b: Runs): boolean =>
  (a ?? []).some(([a0, a1, za]) =>
    (b ?? []).some(
      ([b0, b1, zb]) =>
        a0 < b1 &&
        b0 < a1 &&
        (za === undefined ||
          zb === undefined ||
          Math.abs(za - zb) <= SEAM_STEP_M)
    )
  );

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

/** The pairs of sides two tiles share: [a's side, b's side]. */
function sharedSides(
  a: TerrainBounds,
  b: TerrainBounds
): [EdgeSide, EdgeSide][] {
  const out: [EdgeSide, EdgeSide][] = [];
  if (near(a[1], b[1]) && near(a[3], b[3])) {
    if (near(a[2], b[0])) out.push(["e", "w"]);
    if (near(a[0], b[2])) out.push(["w", "e"]);
  }
  if (near(a[0], b[0]) && near(a[2], b[2])) {
    if (near(a[1], b[3])) out.push(["s", "n"]);
    if (near(a[3], b[1])) out.push(["n", "s"]);
  }
  return out;
}

/** The bodies' rows across the site, joined where they meet at a seam. */
function joinedBodies(tiles: TileWater[]): {
  base: number[];
  root: (k: number) => number;
} {
  const base: number[] = [];
  let total = 0;
  for (const t of tiles) {
    base.push(total);
    total += t.member?.bodies.length ?? 0;
  }
  const parent = Array.from({ length: total }, (_, i) => i);
  const root = (k: number): number => {
    let r = k;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  tiles.forEach((a, i) => {
    tiles.forEach((b, j) => {
      if (j <= i || !a.member || !b.member) {
        return;
      }
      for (const [sa, sb] of sharedSides(a.bounds, b.bounds)) {
        a.member.bodies.forEach((ra, ka) => {
          b.member?.bodies.forEach((rb, kb) => {
            if (overlaps(ra.edges?.[sa], rb.edges?.[sb])) {
              parent[root(base[i] + ka)] = root(base[j] + kb);
            }
          });
        });
      }
    });
  });
  return { base, root };
}

/**
 * Each tile's body colours (0xrrggbb, by row in its `bodies`): every body's
 * measured colour pooled — weighted by the cells it was read from — with
 * the bodies it joins at the tiles' seams (their `edges` overlap), then
 * `waterTint`. A body nothing measured takes the sheet's own colour.
 */
export function siteWaterTints(tiles: TileWater[]): Map<string, number[]> {
  const { base, root } = joinedBodies(tiles);
  const pools = new Map<number, { lab: Lab; seen: number }>();
  tiles.forEach((t, i) => {
    t.member?.bodies.forEach((row, k) => {
      if (!row.lab || !row.core) {
        return;
      }
      const r = root(base[i] + k);
      const pool = pools.get(r) ?? { lab: [0, 0, 0], seen: 0 };
      pool.lab = pool.lab.map(
        (v, c) => v + (row.lab?.[c] ?? 0) * (row.core ?? 0)
      ) as Lab;
      pool.seen += row.core;
      pools.set(r, pool);
    });
  });
  const out = new Map<string, number[]>();
  tiles.forEach((t, i) => {
    out.set(
      t.id,
      (t.member?.bodies ?? []).map((_, k) => {
        const pool = pools.get(root(base[i] + k));
        return pool
          ? waterTint(pool.lab.map((v) => v / pool.seen) as Lab)
          : WATER_SHEET;
      })
    );
  });
  return out;
}

/**
 * What a tile's water sheet reads (TerrainExtras.water): the tint grid
 * with its bodies' colours (`siteWaterTints`) — left out where every body
 * keeps the sheet's own — and, with `foam`, the foam lines in the data
 * frame. Undefined when there is neither.
 */
export function waterLook(
  member: WaterMember | null,
  colours: number[],
  offset: { cx: number; cy: number },
  foam: boolean
): WaterLook | undefined {
  const look: WaterLook = {};
  if (member?.tint && colours.some((c) => c !== WATER_SHEET)) {
    look.tint = { n: member.tint.n, cells: member.tint.cells, colours };
  }
  const lines = foam ? (member?.foam ?? []) : [];
  if (lines.length > 0) {
    const r = (v: number) => Math.round(v * 10) / 10;
    look.foam = lines
      .slice(0, FOAM_LINES)
      .map(({ line: [[x0, y0], [x1, y1]], drop, down }) => [
        r(x0 - offset.cx),
        r(y0 - offset.cy),
        r(x1 - offset.cx),
        r(y1 - offset.cy),
        drop,
        down?.[0] ?? 0,
        down?.[1] ?? 0,
      ]);
  }
  return look.tint || look.foam ? look : undefined;
}
