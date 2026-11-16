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
  LevelHold,
  RasterLedger,
  SiteRasters,
  SparseKind,
  Tier,
  TileCover,
  TileHold,
} from "../lib/city/ledger-rasters";
import type { SourceText } from "../lib/city/ledger";
import { wireBytes } from "../lib/city/ledger";
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
 * named here: a new CPU read is named with its kind.
 */
export const CPU_DECODES: readonly CpuDecode[] = [
  {
    module: "app/_components/vegetation-layer.ts",
    kind: "ndvi",
    use: "the crowns' greenness, sampled once a fine level's dressing builds (loadNdviSampler; the same file is uploaded for the ground too)",
  },
];
/** The module that decodes a raster to upload it. */
export const UPLOAD_PATH = "app/_components/raster-upload.ts";

/** The sites a build serves: every one whose data is ready, as
 *  scripts/prepare-sites.ts picks them. */
export function readySites(): SiteId[] {
  return (Object.keys(SITES) as SiteId[]).filter((id) =>
    siteReport(SITES[id], existsSync).every((t) => t.next === "ready")
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

/** The raster artifacts (and tables) a terrain level names, each with the
 *  viewer kind it is read as. */
const RASTER_ARTIFACTS: readonly {
  artifact: TileArtifactKind;
  kind: RasterKind;
  table: boolean;
}[] = TERRAIN_RASTER_KINDS.flatMap(({ kind: artifact, levels }) => {
  const key = [...(levels[0] ?? []), ...(levels[1] ?? [])][0];
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

interface TileInfo {
  bounds: [number, number, number, number];
  id: string;
}

/** The terrain levels' extras, by tile (fine 0, coarse 1). */
interface TileLevels {
  extras: Record<0 | 1, Record<string, unknown>>;
  info: TileInfo;
}

interface Node {
  children?: Node[];
  extras?: Record<string, unknown>;
}

/** The site tiles and their levels' extras, spawn first (as
 *  lib/city/ledger.ts `ledgerTiles` walks the tree). */
function tileLevels(tileset: unknown): TileLevels[] {
  const json = tileset as {
    extras?: { tiles?: TileInfo[] };
    root?: { children?: Node[] };
  };
  const infos = json.extras?.tiles ?? [];
  const nodes = json.root?.children ?? [];
  return infos.map((info, i) => {
    const coarse = nodes[i]?.children?.[1];
    return {
      info,
      extras: {
        1: coarse?.extras ?? {},
        0: coarse?.children?.[0]?.extras ?? {},
      },
    };
  });
}

/** Every raster file a site publishes, read once. */
async function fileFacts(
  source: RasterSource,
  tiles: readonly TileLevels[]
): Promise<Map<string, FileFacts>> {
  const out = new Map<string, FileFacts>();
  for (const { info } of tiles) {
    const named = tileArtifacts(info.id);
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

/** What one level holds on one tier, by the viewer's rules. */
function levelHold(
  extras: Record<string, unknown>,
  level: 0 | 1,
  phone: boolean,
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
      phone
    );
    const raster = files ? facts.get(files.raster)?.raster : undefined;
    const tableOk = !files?.table || facts.get(files.table)?.rows === true;
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

/** One tile's sparse covers, from its fine level's full files. */
function tileCovers(
  extras: Record<string, unknown>,
  facts: ReadonlyMap<string, FileFacts>
): Partial<Record<SparseKind, TileCover>> {
  const out: Partial<Record<SparseKind, TileCover>> = {};
  for (const kind of SPARSE_KINDS) {
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
  const holds: TileHold[] = tiles.map(({ info, extras }) => {
    const size: [number, number] = [
      info.bounds[2] - info.bounds[0],
      info.bounds[3] - info.bounds[1],
    ];
    for (const [kind, cover] of Object.entries(tileCovers(extras[0], facts))) {
      covers[kind as SparseKind].push(cover);
    }
    const tier = (phone: boolean) => ({
      fine: levelHold(extras[0], 0, phone, size, facts),
      coarse: levelHold(extras[1], 1, phone, size, facts),
    });
    const levels = Object.fromEntries(
      TIERS.map((t) => [t, tier(t === "phone")])
    ) as Record<Tier, Record<"fine" | "coarse", LevelHold>>;
    return { tile: info.id, levels };
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
