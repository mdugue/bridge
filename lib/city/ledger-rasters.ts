/**
 * The ledger's raster table (plan 091, phase 0): for every built site, what
 * a terrain level's rasters weigh on the wire and on the GPU a tier, by sort
 * — exact ids, measured fields, soft fields, and the colour splat the viewer
 * paints from the classes — how much of the sparse rasters carries anything,
 * how many ground programs (`splatVariant` keys) the tiles ask for, and which
 * rasters the viewer decodes on the CPU without uploading them. Pure: the
 * caller (scripts/ledger.ts `measureRasters`) decodes the published files
 * and hands in the viewer's own rules (which file a level reads, the GPU
 * bytes of a texture, the splat's scale); this file states none of them a
 * second time.
 *
 * Every figure here is gated: it is a function of the published files and
 * the viewer's rules, both functions of the tree — the PNG bytes are the
 * committed ones or twins sharp writes at the pinned version (phase 1's
 * wire bytes gate the same files already), the texels are decoded, and no
 * figure is a time.
 */

/** How a raster's values may be stored (plan 091, *Current state*): ids
 *  read texel by texel; fields a line is drawn through; light and tint. */
export type RasterSort = "exact" | "measured" | "soft";

/** The sort of each viewer raster kind (app/_components/tile-rasters.ts
 *  `RasterKind`; the script holds the keys to that type). */
export const SORT_OF = {
  class: "exact",
  surface: "exact",
  sport: "exact",
  markings: "exact",
  edges: "measured",
  colonies: "measured",
  ndvi: "soft",
  svf: "soft",
  horizon: "soft",
} as const satisfies Record<string, RasterSort>;
export type LedgerRasterKind = keyof typeof SORT_OF;

/** The kinds the ground needs no program of its own without: the class
 *  raster decides the splat; the rest each add a term (`splatVariant`). */
export const VARIANT_KINDS = [
  "ndvi",
  "surface",
  "edges",
  "sport",
  "markings",
  "colonies",
  "svf",
  "horizon",
] as const satisfies readonly LedgerRasterKind[];

/** The sparse rasters whose cover the table reports. */
export const SPARSE_KINDS = [
  "surface",
  "sport",
  "markings",
  "colonies",
] as const satisfies readonly LedgerRasterKind[];
export type SparseKind = (typeof SPARSE_KINDS)[number];

/** Whether texel `i`'s bytes (`channels` interleaved from `at`) carry
 *  anything, by the kind's own empty value:
 *  - `surface`, `sport`: every byte 0 (pipeline/bake/surface.py, sport.py);
 *  - `markings`: no row (R + 256·A), no lane bit (G) and the centre offset
 *    at its neutral 128 (B; markings.py `lane_fields`);
 *  - `colonies`: R 0, "far outside" (cultivated.py; the crop's own rule,
 *    scripts/crop-raster.ts `colonyCrop`). */
const CARRIES: Record<
  SparseKind,
  (data: Uint8Array, at: number, channels: number) => boolean
> = {
  surface: anyByte,
  sport: anyByte,
  markings: (d, at) =>
    d[at] !== 0 || d[at + 1] !== 0 || d[at + 2] !== 128 || d[at + 3] !== 0,
  colonies: (d, at) => d[at] !== 0,
};

function anyByte(data: Uint8Array, at: number, channels: number): boolean {
  for (let c = 0; c < channels; c += 1) {
    if (data[at + c] !== 0) {
      return true;
    }
  }
  return false;
}

/** The texels of a raster that carry anything, and their bounding box in
 *  texels (`[x0, y0, x1, y1]`, inclusive; null when none). */
export interface Carry {
  box: [number, number, number, number] | null;
  texels: number;
}

/** What of a decoded raster (`width` texels a row, `channels` interleaved)
 *  carries anything, by `kind`'s empty value. */
export function carryOf(
  kind: SparseKind,
  data: Uint8Array,
  width: number,
  channels: number
): Carry {
  const carries = CARRIES[kind];
  const height = Math.floor(data.length / (width * channels));
  let texels = 0;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (carries(data, (y * width + x) * channels, channels)) {
        texels += 1;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { texels, box: x1 < 0 ? null : [x0, y0, x1, y1] };
}

/* ----------------------------------------------------------- per tile */

/** One raster a level holds on the GPU on one tier: its kind and bytes. */
export interface HeldRaster {
  bytes: number;
  kind: LedgerRasterKind;
}

/** What one terrain level holds on one tier near the camera: its rasters
 *  (the tables are float textures the cache does not weigh, left out), the
 *  colour splat painted from its classes, and its ground program's key. */
export interface LevelHold {
  rasters: HeldRaster[];
  splat: number;
  /** `splatVariant`'s key, or "plain" without a class raster */
  variant: string;
}

export const TIERS = ["desktop", "phone"] as const;
export type Tier = (typeof TIERS)[number];
export const LEVELS = ["fine", "coarse"] as const;
export type LevelName = (typeof LEVELS)[number];

/** A tile's levels on both tiers (`level` 0 is the fine one). */
export interface TileHold {
  levels: Record<Tier, Record<LevelName, LevelHold>>;
  tile: string;
}

/** The program key a level builds (terrain-layer.ts `splatVariant`): the
 *  optional rasters it has, in that function's order, and the tile's size. */
export function variantKey(
  has: ReadonlySet<LedgerRasterKind>,
  size: readonly [number, number]
): string {
  return [
    ...VARIANT_KINDS.map((kind) => (has.has(kind) ? kind : "")),
    ...size,
  ].join("|");
}

/* ------------------------------------------------------------ figures */

/** A figure on the spawn tile and its largest over the site's tiles. */
export interface SpawnMax {
  max: number;
  spawn: number;
}

/** A level's GPU bytes by sort, the splat apart. */
export interface SortBytes {
  exact: number;
  measured: number;
  soft: number;
  splat: number;
  /** the soft fields' share of the total, to the thousandth */
  softShare: number;
  total: number;
}

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/** A level's bytes by sort. */
export function sortBytes(hold: LevelHold): SortBytes {
  const by = { exact: 0, measured: 0, soft: 0 };
  for (const { kind, bytes } of hold.rasters) {
    by[SORT_OF[kind]] += bytes;
  }
  const total = by.exact + by.measured + by.soft + hold.splat;
  return {
    ...by,
    splat: hold.splat,
    total,
    softShare: total === 0 ? 0 : round(by.soft / total, 3),
  };
}

/** The sum of `values`. */
function sumOf(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum;
}

/** The largest of `values`, 0 for none. */
function maxOf(values: readonly number[]): number {
  let max = 0;
  for (const v of values) {
    max = Math.max(max, v);
  }
  return max;
}

const spawnMax = (values: readonly number[]): SpawnMax => ({
  spawn: values[0] ?? 0,
  max: maxOf(values),
});

/** A kind's GPU bytes on one level and tier, over the tiles. */
const kindBytes = (
  holds: readonly TileHold[],
  tier: Tier,
  level: LevelName,
  kind: LedgerRasterKind | "splat"
): SpawnMax =>
  spawnMax(
    holds.map(({ levels }) => {
      const hold = levels[tier][level];
      return kind === "splat"
        ? hold.splat
        : sumOf(
            hold.rasters.filter((r) => r.kind === kind).map((r) => r.bytes)
          );
    })
  );

/** Per kind (and the splat), its GPU bytes by tier and level. */
export function gpuByKind(
  holds: readonly TileHold[]
): Record<
  LedgerRasterKind | "splat",
  Record<Tier, Record<LevelName, SpawnMax>>
> {
  const kinds = [...(Object.keys(SORT_OF) as LedgerRasterKind[]), "splat"];
  return Object.fromEntries(
    kinds.map((kind) => [
      kind,
      Object.fromEntries(
        TIERS.map((tier) => [
          tier,
          Object.fromEntries(
            LEVELS.map((level) => [
              level,
              kindBytes(holds, tier, level, kind as LedgerRasterKind),
            ])
          ),
        ])
      ),
    ])
  ) as ReturnType<typeof gpuByKind>;
}

/** Strings by their code units: no locale reorders a gated figure. */
function codeOrder(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** A fine level by sort on each tier: the spawn tile's and the largest
 *  tile's (by total; ties to the tile id). */
export function fineBySort(
  holds: readonly TileHold[]
): Record<Tier, { largest: SortBytes & { tile: string }; spawn: SortBytes }> {
  const out = {} as ReturnType<typeof fineBySort>;
  for (const tier of TIERS) {
    const rows = holds.map((h) => ({
      tile: h.tile,
      ...sortBytes(h.levels[tier].fine),
    }));
    const first = holds[0];
    const largest = rows.toSorted(
      (a, b) => b.total - a.total || codeOrder(a.tile, b.tile)
    )[0];
    if (first === undefined || largest === undefined) {
      throw new Error("ledger: no tiles");
    }
    out[tier] = { spawn: sortBytes(first.levels[tier].fine), largest };
  }
  return out;
}

/** The distinct ground programs a site's levels ask for, per tier and
 *  over both (a desktop and a phone never share a page). */
export function variantCounts(
  holds: readonly TileHold[]
): Record<Tier, number> & { keys: Record<Tier, string[]> } {
  const keys = (tier: Tier) =>
    [
      ...new Set(
        holds.flatMap((h) => LEVELS.map((l) => h.levels[tier][l].variant))
      ),
    ].toSorted(codeOrder);
  const desktop = keys("desktop");
  const phone = keys("phone");
  return {
    desktop: desktop.length,
    phone: phone.length,
    keys: { desktop, phone },
  };
}

/** One sparse raster's cover on one tile: what carries, of the full
 *  tile raster's texels (a crop counts against the raster it was cut
 *  from). */
export interface TileCover {
  carry: Carry;
  /** the full raster's texels */
  of: number;
  /** where the published file lies in the full raster (a crop's corner) */
  offset?: [number, number];
}

/** A sparse kind's cover over the tiles that have it: the share of
 *  texels that carry anything, and of their bounding box, mean and
 *  largest, to the ten-thousandth. */
export interface CoverFigures {
  box: { max: number; mean: number };
  share: { max: number; mean: number };
  /** the tiles whose fine level has the raster */
  tiles: number;
}

/** The mean and the largest of shares, to the ten-thousandth. */
function meanMax(values: readonly number[]): { max: number; mean: number } {
  return {
    mean: values.length === 0 ? 0 : round(sumOf(values) / values.length, 4),
    max: round(maxOf(values), 4),
  };
}

export function coverFigures(covers: readonly TileCover[]): CoverFigures {
  const shares = covers.map((c) => c.carry.texels / c.of);
  const boxes = covers.map(({ carry: { box }, of }) =>
    box ? ((box[2] - box[0] + 1) * (box[3] - box[1] + 1)) / of : 0
  );
  return {
    tiles: covers.length,
    share: meanMax(shares),
    box: meanMax(boxes),
  };
}

/** A published raster or table artifact over a site: its files, their wire
 *  bytes, and the texture shapes they decode to (`w×h×channels`, `×layers`). */
export interface ArtifactFigures {
  files: number;
  shapes: string[];
  wire: number;
}

/** The shape label of a texture. */
export const shapeOf = (
  width: number,
  height: number,
  channels: number,
  layers = 1
): string => `${width}×${height}×${channels}${layers > 1 ? `×${layers}` : ""}`;

/** Sums artifacts' files over a site (each file once). */
export function artifactFigures(
  files: readonly { artifact: string; shape?: string; wire: number }[]
): Record<string, ArtifactFigures> {
  const out: Record<string, ArtifactFigures> = {};
  for (const { artifact, shape, wire } of files) {
    const row = out[artifact] ?? { files: 0, wire: 0, shapes: [] };
    out[artifact] = row;
    row.files += 1;
    row.wire += wire;
    if (shape && !row.shapes.includes(shape)) {
      row.shapes.push(shape);
    }
  }
  for (const row of Object.values(out)) {
    row.shapes.sort(codeOrder);
  }
  return Object.fromEntries(
    Object.entries(out).toSorted(([a], [b]) => codeOrder(a, b))
  );
}

/** A site's raster table. */
export interface SiteRasters {
  artifacts: Record<string, ArtifactFigures>;
  cover: Record<SparseKind, CoverFigures>;
  fine: ReturnType<typeof fineBySort>;
  gpu: ReturnType<typeof gpuByKind>;
  tiles: number;
  variants: ReturnType<typeof variantCounts>;
}

/** A site's raster table from its tiles' holds, its covers and its files. */
export function siteRasters(
  holds: readonly TileHold[],
  covers: Record<SparseKind, TileCover[]>,
  files: readonly { artifact: string; shape?: string; wire: number }[]
): SiteRasters {
  return {
    tiles: holds.length,
    artifacts: artifactFigures(files),
    gpu: gpuByKind(holds),
    fine: fineBySort(holds),
    cover: Object.fromEntries(
      SPARSE_KINDS.map((kind) => [kind, coverFigures(covers[kind])])
    ) as Record<SparseKind, CoverFigures>,
    variants: variantCounts(holds),
  };
}

/** A raster the viewer decodes on the CPU and never uploads. */
export interface CpuDecode {
  /** the viewer raster kind it reads */
  kind: LedgerRasterKind;
  /** the module that decodes it */
  module: string;
  /** what it is read for */
  use: string;
}

/** The ledger's raster section: the rule, the CPU decodes, every site. */
export interface RasterLedger {
  cpuDecodes: CpuDecode[];
  rule: string;
  sites: Record<string, SiteRasters>;
  /** each kind's sort */
  sorts: typeof SORT_OF;
}

export const RASTER_RULE =
  "Per site, from its published files: each raster and table artifact's files, wire bytes (as `wire`) and decoded texture shapes; each kind's GPU bytes on the spawn tile and the largest over the tiles, per tier and level, near the camera (the viewer's `rasterFiles` and `textureBytes`; the float tables are not weighed, as in the viewer); a fine level by sort, the colour splat painted from the classes apart; the share of texels the sparse rasters carry anything in, and of their bounding box, against the full tile raster; the distinct ground programs (`splatVariant` keys) per tier. Gated: every figure is a function of the tree.";

/** The modules under `app/` that call the PNG decoder, but the upload
 *  path's: what the CPU decodes without uploading. The caller scans the
 *  sources; the ledger fails when one is not named in `known`. */
export function cpuDecodes(
  sources: readonly { path: string; text: string }[],
  uploadPath: string,
  known: readonly CpuDecode[]
): CpuDecode[] {
  const calling = sources
    .filter(
      ({ path, text }) => path !== uploadPath && /decodeGreyPng\(/u.test(text)
    )
    .map(({ path }) => path)
    .toSorted(codeOrder);
  const named = new Set(known.map((k) => k.module));
  const unnamed = calling.filter((path) => !named.has(path));
  if (unnamed.length > 0) {
    throw new Error(
      `ledger: ${unnamed.join(", ")} decode a raster on the CPU: name its kind in CPU_DECODES (scripts/ledger.ts)`
    );
  }
  return known
    .filter((k) => calling.includes(k.module))
    .toSorted((a, b) => codeOrder(a.module, b.module));
}
