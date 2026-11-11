/**
 * A tile's buildings as the minimap's picture (lib/city/footprint-figure.ts):
 * a grey PNG of how much of each pixel the footprints cover, made from the
 * packed footprints the city step wrote (bake-entries.ts `figure`). Its key
 * is those bytes: a change to the buildings' bake that leaves the
 * footprints as they were draws no picture again.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { FIGURE_PX, figureRaster } from "../../lib/city/footprint-figure";
import { readFootprints } from "../../lib/city/footprint-pack";
import { tileExtentOf, tileIdOf } from "../../lib/city/site";
import { BAKE_ENTRIES } from "../bake-entries";
import { SITE, cacheKey, cached, fail, publish } from "./context";

/** The picture of `tile`'s buildings from its packed footprints (gzipped,
 *  as published); its published name. */
export async function bakeFigure(
  tile: string,
  packed: Uint8Array
): Promise<string> {
  const name = `figure_${tile}.png`;
  const digest = createHash("sha256").update(packed).digest("hex");
  const png = await cached(
    name,
    cacheKey([], BAKE_ENTRIES.figure, digest, FIGURE_PX),
    async () => {
      const pack = readFootprints(
        Bun.gunzipSync(packed as Uint8Array<ArrayBuffer>)
      );
      const cell = SITE.tiles.find((c) => tileIdOf(SITE, c) === tile);
      if (!(pack && cell)) {
        fail(`figure: no footprints or no cell for ${tile}`);
      }
      const raster = figureRaster(pack, tileExtentOf(cell));
      return new Uint8Array(
        await sharp(raster, {
          raw: { width: FIGURE_PX, height: FIGURE_PX, channels: 1 },
        })
          // one grey channel: png-raster.ts decodes nothing else
          .toColourspace("b-w")
          .png({ compressionLevel: 9 })
          .toBuffer()
      );
    }
  );
  return publish(name, png);
}
