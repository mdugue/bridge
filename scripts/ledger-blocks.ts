/**
 * Reads the ledger's `blocks` section (plan 091 phase 2) from each built
 * site's published files: every tile's sky-view PNG and the BC4 and EAC
 * R11 blocks the build publishes beside it (the extras' `svf`, `svfBc4`,
 * `svfEac`), decoded by the viewer's PNG decoder and the formats' own
 * rules (scripts/block-encode.ts), handed to lib/city/ledger-blocks.ts.
 */
import { gunzipSync } from "node:zlib";
import { parseBlockRaster } from "../lib/city/block-raster";
import type { BlockFormat } from "../lib/city/block-raster";
import { wireBytes } from "../lib/city/ledger";
import { BLOCK_RULE, siteBlocks } from "../lib/city/ledger-blocks";
import type {
  BlockLedger,
  SiteBlocks,
  TileBlocks,
} from "../lib/city/ledger-blocks";
import { decodeGreyPng } from "../lib/city/png-raster";
import { textureBytes } from "../app/_components/three-utils";
import { RASTER_KINDS } from "../app/_components/tile-rasters";
import { decodeLevel } from "./block-encode";
import type { RasterSource } from "./ledger-rasters";
import { tileLevels } from "./ledger-rasters";

/** The extras key of each format's file (the sky view's row). */
const KEYS = RASTER_KINDS.svf.blocks ?? { bc4: "svfBc4", eac: "svfEac" };

/** One tile's sky view and its blocks, or null where the tile has none. */
async function tileBlocks(
  source: RasterSource,
  extras: Record<string, unknown>
): Promise<TileBlocks | null> {
  const name = (key: string) => {
    const served = extras[key];
    return typeof served === "string" && served !== "" ? served : null;
  };
  const svf = name("svf");
  if (!svf) {
    return null;
  }
  const pngBytes = source.read(svf);
  const png = await decodeGreyPng(pngBytes);
  const formats = {} as TileBlocks["formats"];
  for (const format of ["bc4", "eac"] as const satisfies BlockFormat[]) {
    const served = name(KEYS[format]);
    if (!served) {
      throw new Error(`ledger: ${svf} has no ${format} blocks beside it`);
    }
    const bytes = source.read(served);
    const raster = parseBlockRaster(new Uint8Array(gunzipSync(bytes)));
    formats[format] = {
      wire: wireBytes(served, bytes),
      gpu: raster.levels.reduce((n, l) => n + l.data.length, 0),
      decoded: decodeLevel(raster.levels[0], format),
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
