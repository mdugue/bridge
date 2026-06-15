/**
 * Copies the POC tile (CityJSON + DGM GeoTIFF + .tfw sidecar) from data/
 * into public/data/ so the browser can fetch it. Runs ahead of `dev` and
 * `build`; public/data/ is gitignored to avoid duplicating ~19 MB in git.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { TILE_NAMES } from "../lib/city/tiles";

// The 2 x 2 block loaded by city-walk-client.tsx (shared list). Land-cover and
// canopy are baked offline (scripts/extract-dlm.sh + extract-canopy.sh); the raw
// downloads stay gitignored, only these small per-tile outputs are committed.
const copies: [string, string][] = TILE_NAMES.flatMap((tile) => [
  [
    `data/cityjson/lod2_${tile}.city.json`,
    `public/data/lod2_${tile}.city.json`,
  ],
  [
    `data/dgm/dgm1_${tile}_tiff/dgm1_${tile}.tif`,
    `public/data/dgm1_${tile}.tif`,
  ],
  [
    `data/dgm/dgm1_${tile}_tiff/dgm1_${tile}.tfw`,
    `public/data/dgm1_${tile}.tfw`,
  ],
  [`data/dlm/landcover_${tile}.png`, `public/data/landcover_${tile}.png`],
  [
    `data/dlm/landcover_rgb_${tile}.png`,
    `public/data/landcover_rgb_${tile}.png`,
  ],
  [`data/dlm/vegrows_${tile}.geojson`, `public/data/vegrows_${tile}.geojson`],
  [`data/dlm/canopy_${tile}.geojson`, `public/data/canopy_${tile}.geojson`],
]);

for (const [src, dest] of copies) {
  const srcPath = join(process.cwd(), src);
  const destPath = join(process.cwd(), dest);
  if (!existsSync(srcPath)) {
    process.stderr.write(`prepare-data: missing source file ${src}\n`);
    process.exit(1);
  }
  const upToDate =
    existsSync(destPath) && statSync(destPath).size === statSync(srcPath).size;
  if (upToDate) {
    continue;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
  process.stdout.write(`prepare-data: copied ${src} -> ${dest}\n`);
}
