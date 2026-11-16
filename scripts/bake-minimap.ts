/**
 * The minimap's picture of a site: its land cover in the viewer's palette
 * (bake-wissen-hero.ts `landcoverBlock`), the bridge decks in the colour
 * of what they carry and the buildings as ink, drawn once by the build
 * into one WebP the viewer shows as an image. At the map's scale a pixel
 * is a dozen metres, so the buildings are their cover of each pixel
 * (lib/city/footprint-figure.ts), not outlines: a block reads as a block.
 */
import sharp from "sharp";
import { coverRaster } from "../lib/city/footprint-figure";
import { packFootprints, readFootprints } from "../lib/city/footprint-pack";
import type { FootprintPack } from "../lib/city/footprint-pack";
import { LANDCOVER_CLASSES, landcoverSrgb } from "../lib/city/landcover";
import type { MapBridge } from "../lib/city/minimap";
import { tileExtentOf } from "../lib/city/site";
import type { TileCell } from "../lib/city/site";
import { landcoverBlock } from "./bake-wissen-hero";

/** The picture's width (px): twice the widest the sidebar shows it. */
export const MINIMAP_PX = 640;

/** The buildings' ink and how strong it lies where a pixel is all roof. */
const INK = [50, 53, 62] as const;
const INK_OPACITY = 0.9;
/** Lifts a part-covered pixel's ink (cover^γ): loose houses still read. */
const INK_GAMMA = 0.7;

/** A deck's colour: that of the class it carries (the class raster shows
 *  the river under a bridge). */
const DECK_CLASS: Record<string, string> = {
  rail: "railway",
  road: "road",
  path: "path",
};
function deckColour(kind: string): readonly number[] {
  const key = DECK_CLASS[kind] ?? "road";
  return landcoverSrgb(LANDCOVER_CLASSES.find((c) => c.key === key)?.id ?? 0);
}

/** `colour` laid over `rgb` by `alpha(cover)` per pixel. */
function lay(
  rgb: Buffer,
  cover: Uint8Array,
  colour: readonly number[],
  alpha: (cover: number) => number
): void {
  for (let i = 0; i < cover.length; i += 1) {
    if (cover[i] === 0) {
      continue;
    }
    const a = alpha(cover[i] / 255);
    for (let c = 0; c < 3; c += 1) {
      const at = 3 * i + c;
      rgb[at] = Math.round(rgb[at] * (1 - a) + colour[c] * a);
    }
  }
}

/** The picture's extent (EPSG): the cells' union. */
export function extentOf(
  cells: readonly TileCell[]
): [number, number, number, number] {
  const all = cells.map((c) => tileExtentOf(c));
  return [
    Math.min(...all.map((e) => e[0])),
    Math.min(...all.map((e) => e[1])),
    Math.max(...all.map((e) => e[2])),
    Math.max(...all.map((e) => e[3])),
  ];
}

export interface MinimapInput {
  cells: readonly TileCell[];
  /** every tile's bridge decks */
  decks: readonly MapBridge[];
  /** every tile's buildings */
  packs: readonly FootprintPack[];
  /** each cell's class raster */
  rasters: readonly string[];
}

/** The picture as a WebP about `size` px wide. */
export async function bakeMinimap(
  input: MinimapInput,
  size = MINIMAP_PX
): Promise<Buffer> {
  const { data, height, width } = await landcoverBlock(
    input.cells,
    input.rasters,
    size
  );
  const extent = extentOf(input.cells);
  const kinds = new Set(input.decks.map((d) => d.kind));
  for (const kind of kinds) {
    const pack = readFootprints(
      packFootprints(
        input.decks.filter((d) => d.kind === kind).map((d) => [d.pts])
      )
    );
    if (pack) {
      lay(
        data,
        coverRaster([pack], extent, width, height),
        deckColour(kind),
        (c) => c
      );
    }
  }
  lay(
    data,
    coverRaster(input.packs, extent, width, height),
    INK,
    (c) => INK_OPACITY * c ** INK_GAMMA
  );
  return await sharp(data, { raw: { width, height, channels: 3 } })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();
}
