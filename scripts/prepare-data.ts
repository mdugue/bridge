/**
 * Copies the POC tile (CityJSON + DGM GeoTIFF + .tfw sidecar) from data/
 * into public/data/ so the browser can fetch it. Runs ahead of `dev` and
 * `build`; public/data/ is gitignored to avoid duplicating ~19 MB in git.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const TILE = "33412_5656_2_sn";

const copies: [string, string][] = [
  [
    `data/cityjson/lod2_${TILE}.city.json`,
    `public/data/lod2_${TILE}.city.json`,
  ],
  [
    `data/dgm/dgm1_${TILE}_tiff/dgm1_${TILE}.tif`,
    `public/data/dgm1_${TILE}.tif`,
  ],
  [
    `data/dgm/dgm1_${TILE}_tiff/dgm1_${TILE}.tfw`,
    `public/data/dgm1_${TILE}.tfw`,
  ],
];

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
