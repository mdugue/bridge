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
import { TILE_KM, type TileCell } from "../lib/city/site";

/** Where each cell sits in the block: easting grows east, northing north. */
function gridOf(cells: readonly TileCell[]) {
  const minE = Math.min(...cells.map((c) => c.e));
  const maxN = Math.max(...cells.map((c) => c.n));
  return cells.map((c) => ({
    col: (c.e - minE) / TILE_KM,
    row: (maxN - c.n) / TILE_KM,
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
 * The block as a WebP `size` px wide: `rasters[i]` is the class raster of
 * `cells[i]` (any edge; each is scaled to its cell).
 */
export async function bakeWissenHero(
  cells: readonly TileCell[],
  rasters: readonly string[],
  size: number
): Promise<Buffer> {
  const grid = gridOf(cells);
  const cols = Math.max(...grid.map((g) => g.col)) + 1;
  const rows = Math.max(...grid.map((g) => g.row)) + 1;
  const cell = Math.round(size / cols);
  const layers = await Promise.all(
    grid.map(async ({ col, row }, i) => {
      const input = await (
        await paint(rasters[i])
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
      height: cell * rows,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(layers)
    .webp({ quality: 80, effort: 5 })
    .toBuffer();
}
