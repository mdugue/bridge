/**
 * Reads the ledger's `blocks` section (plan 091 phase 2) from each built
 * site's published files: every tile's sky-view PNG (the extras' `svf`),
 * encoded as the BC4 and EAC R11 files a build with `SVF_BLOCKS=1`
 * publishes beside it (scripts/block-encode.ts `publishedBlockFile`, the
 * build's own call) and decoded by the formats' own rules, handed to
 * lib/city/ledger-blocks.ts. Two minutes for the seven sites: the ledger
 * reads it with `--blocks` only.
 */
import { gunzipSync } from "node:zlib";
import { parseBlockRaster } from "../lib/city/block-raster";
import type { BlockFormat, BlockLevel } from "../lib/city/block-raster";
import { wireBytes } from "../lib/city/ledger";
import { BLOCK_RULE, siteBlocks } from "../lib/city/ledger-blocks";
import type {
  BlockLedger,
  SiteBlocks,
  TileBlocks,
} from "../lib/city/ledger-blocks";
import { decodeGreyPng } from "../lib/city/png-raster";
import { textureBytes } from "../app/_components/three-utils";
import { decodeLevel, mipChain, publishedBlockFile } from "./block-encode";
import type { Grey } from "./block-encode";
import type { RasterSource } from "./ledger-rasters";
import { tileLevels } from "./ledger-rasters";

/** The largest texel error of levels 1 on against the chain they were
 *  encoded from. */
function mipsMax(
  levels: readonly BlockLevel[],
  chain: readonly Grey[],
  format: BlockFormat
): number {
  let max = 0;
  for (const [k, level] of levels.entries()) {
    if (k === 0) {
      continue;
    }
    const decoded = decodeLevel(level, format);
    const source = chain[k].data;
    for (const [i, v] of decoded.entries()) {
      max = Math.max(max, Math.abs(v - source[i]));
    }
  }
  return max;
}

/** One tile's sky view and the blocks a flagged build publishes beside
 *  it, encoded here from the published PNG; null where the tile has none. */
async function tileBlocks(
  source: RasterSource,
  extras: Record<string, unknown>
): Promise<TileBlocks | null> {
  const { svf } = extras;
  if (typeof svf !== "string" || svf === "") {
    return null;
  }
  const pngBytes = source.read(svf);
  const png = await decodeGreyPng(pngBytes);
  const chain = mipChain(png);
  const formats = {} as TileBlocks["formats"];
  for (const format of ["bc4", "eac"] as const satisfies BlockFormat[]) {
    const file = publishedBlockFile(png, format);
    const raster = parseBlockRaster(new Uint8Array(gunzipSync(file)));
    let gpu = 0;
    for (const level of raster.levels) {
      gpu += level.data.length;
    }
    formats[format] = {
      // (a `.gz` counts at face value, `wireBytes`' rule)
      wire: file.length,
      gpu,
      decoded: decodeLevel(raster.levels[0], format),
      mipsMax: mipsMax(raster.levels, chain, format),
    };
  }
  return {
    png: {
      data: png.data,
      wire: wireBytes(svf, pngBytes),
      gpu: textureBytes(png.width, png.height, 1, true),
    },
    formats,
  };
}

/** A site's figures: its tiles' sky views, the fine level's names (both
 *  levels and the buildings name the same files). */
export async function measureBlocks(source: RasterSource): Promise<SiteBlocks> {
  const tiles: TileBlocks[] = [];
  for (const tile of tileLevels(source.tileset)) {
    const blocks = await tileBlocks(source, tile.extras[0]);
    if (blocks) {
      tiles.push(blocks);
    }
  }
  return siteBlocks(tiles);
}

export async function blockLedger(
  sites: readonly string[],
  source: (site: string) => RasterSource
): Promise<BlockLedger> {
  const out: Record<string, SiteBlocks> = {};
  for (const site of sites) {
    out[site] = await measureBlocks(source(site));
  }
  return { rule: BLOCK_RULE, sites: out };
}
