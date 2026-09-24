/**
 * The picture on the /wissen pages: the tile block's land cover (the ground
 * the viewer paints, from the Basis-DLM) in the viewer's own palette
 * (lib/city/landcover.ts), as one map of the city, so the knowledge base
 * opens on the project's own data rather than on a stock image. Baked by
 * scripts/prepare-data.ts next to the viewer's data and published under a
 * content-hashed name like every other artifact; the pages hand it to
 * next/image, which serves the widths they need.
 */
import sharp from "sharp";
import { landcoverSrgb } from "../lib/city/landcover";

/** Where a tile sits in the block: easting grows east, northing north. */
function gridOf(tiles: readonly string[], step: number) {
  const coords = tiles.map((tile) => {
    const [, e, n] = tile.match(/^(\d+)_(\d+)/u) ?? [];
    return { tile, e: Number(e), n: Number(n) };
  });
  const minE = Math.min(...coords.map((c) => c.e));
  const maxN = Math.max(...coords.map((c) => c.n));
  return coords.map((c) => ({
    tile: c.tile,
    col: (c.e - minE) / step,
    row: (maxN - c.n) / step,
  }));
}

/** A class raster painted in the palette, as a raw RGB image. */
async function paint(classRaster: string) {
  const { data, info } = await sharp(classRaster)
    .removeAlpha()
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = new Uint8Array(info.width * info.height * 3);
  for (let i = 0; i < data.length; i++) {
    rgb.set(landcoverSrgb(data[i]), i * 3);
  }
  return sharp(rgb, {
    raw: { width: info.width, height: info.height, channels: 3 },
  });
}

/**
 * The block as a square WebP `size` px wide. `rasterOf(tile)` is the class
 * raster of that tile (any edge; each is scaled to its cell); `tileKm` the
 * tile edge in the names' units.
 */
export async function bakeWissenHero(
  tiles: readonly string[],
  rasterOf: (tile: string) => string,
  size: number,
  tileKm: number
): Promise<Buffer> {
  const grid = gridOf(tiles, tileKm);
  const cols = Math.max(...grid.map((g) => g.col)) + 1;
  const cell = Math.round(size / cols);
  const layers = await Promise.all(
    grid.map(async ({ tile, col, row }) => {
      const input = await (
        await paint(rasterOf(tile))
      )
        .resize(cell, cell, { kernel: "lanczos3", fit: "fill" })
        .png()
        .toBuffer();
      return { input, left: col * cell, top: row * cell };
    })
  );
  return sharp({
    create: {
      width: cell * cols,
      height: cell * cols,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(layers)
    .webp({ quality: 80, effort: 5 })
    .toBuffer();
}
