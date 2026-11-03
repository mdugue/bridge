/**
 * The Stadtwissen as `bun dev`/`bun run build` published it under
 * `public/data/<site>/` (through its manifest's hashed names): what the
 * command-line tools read (`scripts/stadtwissen.ts`, `scripts/osm-gaps.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STADTWISSEN_FILE,
  type StadtwissenIndex,
  type WissenTile,
} from "../lib/city/stadtwissen";

export function loadStadtwissen(siteId: string): {
  index: StadtwissenIndex;
  tiles: () => WissenTile[];
} {
  const dir = join(import.meta.dir, "..", "public", "data", siteId);
  const manifest = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8")
  ) as { files: Record<string, string> };
  const read = <T>(file: string): T =>
    JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
  const indexFile = manifest.files[STADTWISSEN_FILE];
  if (!indexFile) {
    throw new Error(`no ${STADTWISSEN_FILE} for ${siteId}: run bun dev first`);
  }
  const index = read<StadtwissenIndex>(indexFile);
  return {
    index,
    tiles: () => index.tiles.map((t) => read<WissenTile>(t.file)),
  };
}
