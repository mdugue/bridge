/**
 * A site's Stadtwissen for the chat's server tools (ADR 0056), read from
 * the copy the build keeps outside public/ (scripts/prepare-sites.ts,
 * traced into this function by next.config.ts) once per instance.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Knowledge, knowledgeOf } from "@/lib/city/ask-knowledge";
import {
  STADTWISSEN_FILE,
  type StadtwissenIndex,
  type WissenTile,
} from "@/lib/city/stadtwissen";

const loaded = new Map<string, Promise<Knowledge | null>>();

async function load(site: string): Promise<Knowledge | null> {
  // the folder written out, not SERVER_WISSEN_DIR: the bundler traces a
  // read by its literal path, and a variable one takes the whole project
  const dir = join(process.cwd(), ".stadtwissen", site);
  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(join(dir, file), "utf8")) as T;
  try {
    const index = await read<StadtwissenIndex>(STADTWISSEN_FILE);
    const tiles = await Promise.all(
      index.tiles.map((t) => read<WissenTile>(t.file))
    );
    return knowledgeOf(index, tiles);
  } catch {
    return null;
  }
}

/** The site's knowledge, or null where the build published none. */
export function siteKnowledge(site: string): Promise<Knowledge | null> {
  let pending = loaded.get(site);
  if (!pending) {
    pending = load(site);
    loaded.set(site, pending);
    // a failed read is tried again by the next request
    void pending.then((k) => {
      if (!k) {
        loaded.delete(site);
      }
    });
  }
  return pending;
}
