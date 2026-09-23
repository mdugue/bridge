/**
 * The picture on the /wissen pages: the tile block's pastel land-cover splat
 * (the ground the viewer paints, from the Basis-DLM) as one map of the city,
 * so the knowledge base opens on the project's own data rather than on a
 * stock image. Baked by scripts/prepare-data.ts next to the viewer's data and
 * published under a content-hashed name like every other artifact; the pages
 * hand it to next/image, which serves the widths they need.
 *
 * The splat's alpha channel is water COVERAGE (see downsample-raster.ts), so
 * alpha is dropped before any resize – kept, it would turn every land texel
 * transparent or, through sharp's premultiplied resize, black.
 */
import sharp from "sharp";

/** Where a tile sits in the block: easting grows east, northing north. */
function gridOf(tiles: readonly string[]) {
  const coords = tiles.map((tile) => {
    const [, e, n] = tile.match(/^(\d+)_(\d+)/u) ?? [];
    return { tile, e: Number(e), n: Number(n) };
  });
  const minE = Math.min(...coords.map((c) => c.e));
  const maxN = Math.max(...coords.map((c) => c.n));
  const step = 2; // km per tile, in the names' units
  return coords.map((c) => ({
    tile: c.tile,
    col: (c.e - minE) / step,
    row: (maxN - c.n) / step,
  }));
}

/**
 * The block as a square WebP `size` px wide. `rasterOf(tile)` is the RGB
 * splat of that tile (any edge; each is scaled to its cell).
 */
export async function bakeWissenHero(
  tiles: readonly string[],
  rasterOf: (tile: string) => string,
  size: number
): Promise<Buffer> {
  const grid = gridOf(tiles);
  const cols = Math.max(...grid.map((g) => g.col)) + 1;
  const cell = Math.round(size / cols);
  const layers = await Promise.all(
    grid.map(async ({ tile, col, row }) => {
      // Alpha off first, on the full-size raster: no resize has seen it yet.
      const { data, info } = await sharp(rasterOf(tile))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const input = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 3 },
      })
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
