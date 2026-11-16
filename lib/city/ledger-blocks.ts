/**
 * The ledger's `blocks` section (plan 091 phase 2, the trial of block
 * compression on the sky view): for every built site, what its sky-view
 * rasters weigh on the wire and on the GPU as the PNG the viewer reads and
 * as each block format the build publishes beside it (BC4, EAC R11; read
 * behind `?svf=blocks`), and the error of the value the shader reads from
 * the blocks against the PNG's byte, in byte steps. Pure: the caller
 * (scripts/ledger-blocks.ts) reads and decodes the published files.
 *
 * Every figure is gated: the files are the build's (the PNGs committed,
 * the blocks the pinned encoder's, byte-stable), the error is the formats'
 * own decode, summed in a fixed order, and no figure is a time.
 */
import type { BlockFormat } from "./block-raster";

export const BLOCK_RULE =
  "The sky view (svf) of every tile that has one, as the PNG and as the build's GPU blocks with their mip chain (lib/city/block-raster.ts). wire: the published files (the blocks pre-gzipped). gpu: the texture's bytes, the PNG's as the viewer lays it out (one byte a texel, a third more for the GPU's mips), the blocks' as uploaded (half a byte a texel, the chain in the file). error: |decoded block − PNG byte| over level 0's texels in byte steps, by the formats' rules (scripts/block-encode.ts `decodeLevel`; a GPU may read up to 0.86 below for BC4, 0.12 for EAC: scripts/eval/block-raster-probe.ts) — the mean over the site's texels, the largest tile p99, the largest texel.";

/** One raster's figures in one form. */
export interface BlockFigures {
  gpu: number;
  wire: number;
}

/** The error of one block format over a site, in byte steps. */
export interface BlockError {
  max: number;
  mean: number;
  p99: number;
}

export interface SiteBlocks {
  /** the tiles with a sky view (and its blocks) */
  tiles: number;
  png: BlockFigures;
  bc4: BlockFigures & { error: BlockError };
  eac: BlockFigures & { error: BlockError };
}

export interface BlockLedger {
  rule: string;
  sites: Record<string, SiteBlocks>;
}

/** One tile's sky view, decoded: the PNG's bytes and what each format
 *  reads back from level 0, with the files' figures. */
export interface TileBlocks {
  png: BlockFigures & { data: Uint8Array };
  formats: Record<BlockFormat, BlockFigures & { decoded: Float64Array }>;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** A tile's errors in one format: the sum (for the site's mean), its p99
 *  and its largest. */
function tileError(
  png: Uint8Array,
  decoded: Float64Array
): { max: number; p99: number; sum: number } {
  const errors = new Float64Array(png.length);
  let sum = 0;
  for (let i = 0; i < png.length; i += 1) {
    errors[i] = Math.abs(decoded[i] - png[i]);
    sum += errors[i];
  }
  errors.sort();
  return {
    sum,
    p99: errors[Math.floor(0.99 * (errors.length - 1))] ?? 0,
    max: errors.at(-1) ?? 0,
  };
}

const FORMATS: readonly BlockFormat[] = ["bc4", "eac"];

/** A site's figures from its tiles' (in the tileset's order). */
export function siteBlocks(tiles: readonly TileBlocks[]): SiteBlocks {
  const add = (a: BlockFigures, b: BlockFigures): BlockFigures => ({
    gpu: a.gpu + b.gpu,
    wire: a.wire + b.wire,
  });
  const none: BlockFigures = { gpu: 0, wire: 0 };
  let texels = 0;
  let png = none;
  for (const tile of tiles) {
    texels += tile.png.data.length;
    png = add(png, tile.png);
  }
  const format = (f: BlockFormat): SiteBlocks[BlockFormat] => {
    let sum = 0;
    let p99 = 0;
    let max = 0;
    let figures = none;
    for (const tile of tiles) {
      const e = tileError(tile.png.data, tile.formats[f].decoded);
      sum += e.sum;
      p99 = Math.max(p99, e.p99);
      max = Math.max(max, e.max);
      figures = add(figures, tile.formats[f]);
    }
    return {
      gpu: figures.gpu,
      wire: figures.wire,
      error: {
        mean: round3(texels > 0 ? sum / texels : 0),
        p99: round3(p99),
        max: round3(max),
      },
    };
  };
  const [bc4, eac] = FORMATS.map(format);
  return {
    tiles: tiles.length,
    png,
    bc4,
    eac,
  };
}
