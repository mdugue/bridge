/**
 * Reads the raster table of the ledger (plan 091, phase 0) from a site's
 * published files: decodes each terrain raster with the viewer's own PNG
 * decoder, asks the viewer's rules which file a level reads on a tier
 * (`rasterFiles`), how its texture is laid out (`RASTER_KINDS`' looks) and
 * what it weighs on the GPU (`textureBytes`, `splatScaleFor`), and hands
 * the figures to lib/city/ledger-rasters.ts. scripts/ledger.ts writes the
 * result into `qa/ledger.json`'s `rasters` section, every built site.
 */
import { existsSync } from "node:fs";
import nodePath from "node:path";
import { splatScaleFor } from "../app/_components/landcover-splat";
import { RASTER_KINDS, rasterFiles } from "../app/_components/tile-rasters";
import type { RasterKind } from "../app/_components/tile-rasters";
import { textureBytes } from "../app/_components/three-utils";
import {
  carryOf,
  cpuDecodes,
  RASTER_RULE,
  shapeOf,
  siteRasters,
  SORT_OF,
  SPARSE_KINDS,
  TIERS,
  variantKey,
} from "../lib/city/ledger-rasters";
import type {
  Carry,
  CpuDecode,
  HeldRaster,
  LedgerRasterKind,
  LevelName,
  LevelHold,
  RasterLedger,
  SiteRasters,
  SparseKind,
  Tier,
  TileCover,
  TileHold,
} from "../lib/city/ledger-rasters";
import type { SourceText } from "../lib/city/ledger";
import { ledgerTiles, wireBytes } from "../lib/city/ledger";
import { decodeGreyPng } from "../lib/city/png-raster";
import { siteReport } from "../lib/city/site-report";
import { tileArtifacts, TERRAIN_RASTER_KINDS } from "../lib/city/tile";
import type { TileArtifactKind } from "../lib/city/tile";
import type { ContentExtras } from "../lib/city/tileset";
import { SITES } from "../sites";
import type { SiteId } from "../sites";

// the ledger's kinds are the viewer's, both ways
const SAME_KINDS: Record<RasterKind, LedgerRasterKind> &
  Record<LedgerRasterKind, RasterKind> = {
  class: "class",
  ndvi: "ndvi",
  surface: "surface",
  edges: "edges",
  sport: "sport",
  markings: "markings",
  colonies: "colonies",
  svf: "svf",
  horizon: "horizon",
};
const KINDS = Object.keys(SAME_KINDS) as RasterKind[];

/**
 * What the viewer decodes on the CPU and never uploads, by module. The
 * ledger scans app/ for the PNG decoder's callers and fails on one not
 * named here: a new CPU read is named with its kind. None since plan 090's
 * phase 1: the crowns' greenness, the last, is baked into each tree's
 * record (lib/city/tree-table.ts).
 */
export const CPU_DECODES: readonly CpuDecode[] = [];
/** The module that decodes a raster to upload it. */
export const UPLOAD_PATH = "app/_components/raster-upload.ts";

/** The sites a build serves: every one whose data is ready, as
 *  scripts/prepare-sites.ts picks them. */
export function readySites(root = process.cwd()): SiteId[] {
  // (the report names its files from the repository's root)
  const exists = (file: string) => existsSync(nodePath.resolve(root, file));
  return (Object.keys(SITES) as SiteId[]).filter((id) =>
    siteReport(SITES[id], exists).every((t) => t.next === "ready")
  );
}

/** Which viewer kind an extras key names (as its file, a twin, or its
 *  table), from the kinds table. */
const KIND_OF_KEY: ReadonlyMap<string, { kind: RasterKind; table: boolean }> =
  new Map(
    KINDS.flatMap((kind): [string, { kind: RasterKind; table: boolean }][] => {
      const row = RASTER_KINDS[kind];
      const files = [row.extras, row.phone, row.far].filter(
        (k): k is NonNullable<typeof k> => k !== undefined
      );
      return [
        ...files.map((k): [string, { kind: RasterKind; table: boolean }] => [
          k,
          { kind, table: false },
        ]),
        ...(row.table
          ? [
              [row.table, { kind, table: true }] as [
                string,
                { kind: RasterKind; table: boolean },
              ],
            ]
          : []),
      ];
    })
  );

/** The extras keys of the soft rasters' GPU blocks (plan 091 phase 2's
 *  trial): read only behind `?svf=blocks`, so in no tier's table here;
 *  their own figures are the `blocks` section (scripts/ledger-blocks.ts). */
export const BLOCK_KEYS: ReadonlySet<string> = new Set(
  KINDS.flatMap((kind) => Object.values(RASTER_KINDS[kind].blocks ?? {}))
);

/** The raster artifacts (and tables) a terrain level names, each with the
 *  viewer kind it is read as. */
const RASTER_ARTIFACTS: readonly {
  artifact: TileArtifactKind;
  kind: RasterKind;
  table: boolean;
}[] = TERRAIN_RASTER_KINDS.flatMap(({ kind: artifact, levels }) => {
  const key = [...(levels[0] ?? []), ...(levels[1] ?? [])][0];
  if (key !== undefined && BLOCK_KEYS.has(key)) {
    return [];
  }
  const of = key === undefined ? undefined : KIND_OF_KEY.get(key);
  if (!of) {
    throw new Error(`ledger: no raster kind reads ${artifact}`);
  }
  return [{ artifact, ...of }];
});

/** A published raster as the viewer would hold it. */
interface RasterFacts {
  /** the texture's GPU bytes (`textureBytes` by its look) */
  bytes: number;
  /** what of it carries anything (the sparse kinds' full files) */
  carry?: Carry;
  height: number;
  kind: RasterKind;
  /** the decode gave the shape the look asks for */
  valid: boolean;
  width: number;
}

/** The figures of one published file, by served name. */
interface FileFacts {
  artifact: TileArtifactKind;
  raster?: RasterFacts;
  /** a table's rows exist for its raster (tile-rasters.ts `HOOKS`) */
  rows?: boolean;
  shape?: string;
  wire: number;
}

/** The artifacts whose full file the cover is read from. */
const COVER_OF: Partial<Record<TileArtifactKind, SparseKind>> = {
  surface: "surface",
  sport: "sport",
  markings: "markings",
  cultivatedRaster: "colonies",
};

async function rasterFacts(
  bytes: Uint8Array,
  kind: RasterKind,
  cover: SparseKind | undefined
): Promise<{ raster: RasterFacts; shape: string }> {
  const { look } = RASTER_KINDS[kind];
  const png = await decodeGreyPng(bytes);
  const width = png.width / look.channels;
  const height = look.layers ? width : png.height;
  const layers = look.layers ?? 1;
  const valid = Number.isInteger(width) && png.height === height * layers;
  return {
    shape: shapeOf(width, height, look.channels, layers),
    raster: {
      kind,
      width,
      height,
      valid,
      bytes: textureBytes(
        width,
        height * layers,
        look.channels,
        look.mipmaps === true
      ),
      ...(cover
        ? { carry: carryOf(cover, png.data, width, look.channels) }
        : {}),
    },
  };
}

/** Whether a table has the rows its raster is read through — the viewer's
 *  own tests (tile-rasters.ts `HOOKS`: grounds for the sports grounds,
 *  a `markings` list for the markings). */
function tableRows(kind: RasterKind, json: unknown): boolean {
  const doc = json as { grounds?: unknown[]; markings?: unknown } | null;
  if (kind === "sport") {
    return (doc?.grounds?.length ?? 0) > 0;
  }
  return doc?.markings !== undefined && doc.markings !== null;
}

/** A site's published files as the ledger reads them. */
export interface RasterSource {
  files: Record<string, string>;
  read: (served: string) => Uint8Array;
  tileset: unknown;
}

/** A site tile's id, bounds and terrain levels' extras (fine 0, coarse 1). */
interface TileLevels {
  bounds: [number, number, number, number];
  extras: Record<0 | 1, Record<string, unknown>>;
  id: string;
}

/** The site tiles, spawn first, walked by the ledger's own reader
 *  (`ledgerTiles`, which throws on a tree it does not know), with the
 *  bounds the tileset's tile list gives each. */
export function tileLevels(tileset: unknown): TileLevels[] {
  const infos =
    (tileset as { extras?: { tiles?: { bounds?: unknown }[] } }).extras
      ?.tiles ?? [];
  return ledgerTiles(tileset).map((tile, i) => {
    const bounds = infos[i]?.bounds;
    if (
      !(
        Array.isArray(bounds) &&
        bounds.length === 4 &&
        bounds.every((v) => typeof v === "number")
      )
    ) {
      throw new Error(`ledger: the tileset gives ${tile.id} no bounds`);
    }
    return {
      id: tile.id,
      bounds: bounds as [number, number, number, number],
      extras: { 0: tile.terrain[0].extras, 1: tile.terrain[1].extras },
    };
  });
}

/** Every raster file a site publishes, read once. */
async function fileFacts(
  source: RasterSource,
  tiles: readonly TileLevels[]
): Promise<Map<string, FileFacts>> {
  const out = new Map<string, FileFacts>();
  for (const { id } of tiles) {
    const named = tileArtifacts(id);
    for (const { artifact, kind, table } of RASTER_ARTIFACTS) {
      const served = source.files[named[artifact].file];
      if (served === undefined || out.has(served)) {
        continue;
      }
      const bytes = source.read(served);
      const wire = wireBytes(served, bytes);
      if (table) {
        const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
        out.set(served, { artifact, wire, rows: tableRows(kind, json) });
        continue;
      }
      const { raster, shape } = await rasterFacts(
        bytes,
        kind,
        COVER_OF[artifact]
      );
      out.set(served, { artifact, wire, shape, raster });
    }
  }
  return out;
}

/** A file the extras name, read; an extras name the site did not
 *  publish is an error, never an absent raster. */
function factsOf(
  facts: ReadonlyMap<string, FileFacts>,
  served: string
): FileFacts {
  const found = facts.get(served);
  if (!found) {
    throw new Error(
      `ledger: the extras name ${served}, which is not published`
    );
  }
  return found;
}

/** Where a level is read: its level, and whether beyond the ground
 *  detail's reach (the far twins). */
interface Reach {
  far: boolean;
  level: 0 | 1;
  phone: boolean;
}

/** What one level holds on one tier at one reach, by the viewer's rules. */
function levelHold(
  extras: Record<string, unknown>,
  { level, phone, far }: Reach,
  size: [number, number],
  facts: ReadonlyMap<string, FileFacts>
): LevelHold {
  const rasters: HeldRaster[] = [];
  const has = new Set<LedgerRasterKind>();
  let classWidth: number | null = null;
  let classHeight = 0;
  for (const kind of KINDS) {
    const files = rasterFiles(
      // reason: a terrain level's extras, read for their file names only
      { ...extras, level } as unknown as ContentExtras,
      kind,
      phone,
      far
    );
    const raster = files ? factsOf(facts, files.raster).raster : undefined;
    const tableOk = !files?.table || factsOf(facts, files.table).rows === true;
    if (!(raster?.valid && tableOk)) {
      continue;
    }
    rasters.push({ kind: SAME_KINDS[kind], bytes: raster.bytes });
    has.add(SAME_KINDS[kind]);
    if (kind === "class") {
      classWidth = raster.width;
      classHeight = raster.height;
    }
  }
  if (classWidth === null) {
    return { rasters, splat: 0, variant: "plain" };
  }
  const scale = splatScaleFor(classWidth);
  return {
    rasters,
    splat: textureBytes(classWidth / scale, classHeight / scale, 4, true),
    variant: variantKey(has, size),
  };
}

/** One tile's sparse covers, from its fine level's full files: those a
 *  desktop's fine level holds (`held`; a sports raster without grounds in
 *  its table is none). */
function tileCovers(
  extras: Record<string, unknown>,
  held: LevelHold,
  facts: ReadonlyMap<string, FileFacts>
): Partial<Record<SparseKind, TileCover>> {
  const out: Partial<Record<SparseKind, TileCover>> = {};
  for (const kind of SPARSE_KINDS) {
    if (!held.rasters.some((r) => r.kind === kind)) {
      continue;
    }
    const served = extras[RASTER_KINDS[kind].extras];
    const raster =
      typeof served === "string" ? facts.get(served)?.raster : undefined;
    if (!raster?.carry) {
      continue;
    }
    // a colony crop counts against the raster it was cut from
    const crop = extras.cultivatedCrop as number[] | undefined;
    const full = kind === "colonies" && crop ? (crop[4] ?? 0) : raster.width;
    out[kind] = {
      carry: raster.carry,
      of: kind === "colonies" ? full * full : raster.width * raster.height,
    };
  }
  return out;
}

/** A site's raster table from its published files. */
export async function measureRasters(
  source: RasterSource
): Promise<SiteRasters> {
  const tiles = tileLevels(source.tileset);
  const facts = await fileFacts(source, tiles);
  const covers: Record<SparseKind, TileCover[]> = {
    surface: [],
    sport: [],
    markings: [],
    colonies: [],
  };
  const holds: TileHold[] = tiles.map(({ id, bounds, extras }) => {
    const size: [number, number] = [
      bounds[2] - bounds[0],
      bounds[3] - bounds[1],
    ];
    const tier = (phone: boolean): Record<LevelName, LevelHold> => ({
      fine: levelHold(extras[0], { level: 0, phone, far: false }, size, facts),
      fineFar: levelHold(
        extras[0],
        { level: 0, phone, far: true },
        size,
        facts
      ),
      coarse: levelHold(
        extras[1],
        { level: 1, phone, far: false },
        size,
        facts
      ),
    });
    const levels = Object.fromEntries(
      TIERS.map((t) => [t, tier(t === "phone")])
    ) as Record<Tier, Record<LevelName, LevelHold>>;
    const covered = tileCovers(extras[0], levels.desktop.fine, facts);
    for (const [kind, cover] of Object.entries(covered)) {
      covers[kind as SparseKind].push(cover);
    }
    return { tile: id, levels };
  });
  const files = [...facts.values()].map(({ artifact, shape, wire }) => ({
    artifact,
    wire,
    ...(shape ? { shape } : {}),
  }));
  return siteRasters(holds, covers, files);
}

/** The raster section over `sites`: each site's table, read by `source`. */
export async function rasterLedger(
  sites: readonly string[],
  source: (site: string) => RasterSource,
  appSources: readonly SourceText[]
): Promise<RasterLedger> {
  const out: Record<string, SiteRasters> = {};
  for (const site of sites) {
    out[site] = await measureRasters(source(site));
  }
  return {
    rule: RASTER_RULE,
    sorts: SORT_OF,
    cpuDecodes: cpuDecodes(appSources, UPLOAD_PATH, CPU_DECODES),
    sites: out,
  };
}
