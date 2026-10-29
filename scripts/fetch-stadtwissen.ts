/**
 * `bun scripts/fetch-stadtwissen.ts <site>`: the site's Wikidata excerpt
 * for the Stadtwissen (lib/city/stadtwissen.ts) — for every landmark the
 * bake matched (`data/<site>/dlm/landmarks_<tile>.json`) its label,
 * description, German article and the statements `WIKIDATA_PROPERTIES`
 * lists, each value in words — written to `data/<site>/wissen/wikidata.json`
 * and committed: the build stays offline, and Wikidata is CC0. Run it again
 * after a landmark bake, or to take Wikidata's newer edits.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LandmarkFile } from "../lib/city/landmarks";
import {
  labelOf,
  type RawEntity,
  referencedItems,
  WIKIDATA_FACTS_FILE,
  type WikidataFacts,
  type WikidataFile,
  wikidataFacts,
} from "../lib/city/stadtwissen";
import { cityMeshSourceFiles, siteDataDir, tileIds } from "../lib/city/tile";
import { siteFromArgs } from "../sites";

const API = "https://www.wikidata.org/w/api.php";
const AGENT = "bridge-bake/0.1 (city walker; https://github.com/mdugue/bridge)";
/** wbgetentities takes at most 50 ids a call */
const BATCH = 50;

const ROOT = join(import.meta.dir, "..");
const { site } = siteFromArgs(process.argv.slice(2));

/** One GET, waiting out Wikidata's rate limit (429, `Retry-After`). */
async function politely(url: string, tries = 6): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": AGENT } });
    if (res.ok) {
      return res.json();
    }
    if (res.status !== 429 || attempt >= tries) {
      throw new Error(`Wikidata answered ${res.status}`);
    }
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await Bun.sleep(wait * 1000);
  }
}

async function entities(
  ids: readonly string[],
  props: string
): Promise<Record<string, RawEntity>> {
  const out: Record<string, RawEntity> = {};
  for (let i = 0; i < ids.length; i += BATCH) {
    const params = new URLSearchParams({
      action: "wbgetentities",
      format: "json",
      ids: ids.slice(i, i + BATCH).join("|"),
      languages: "de|en",
      props,
      sitefilter: "dewiki",
    });
    const body = (await politely(`${API}?${params}`)) as {
      entities: Record<string, RawEntity>;
    };
    Object.assign(out, body.entities);
  }
  return out;
}

const landmarkIds = new Set<string>();
for (const tile of tileIds(site)) {
  const path = join(ROOT, cityMeshSourceFiles(site, tile).landmarks);
  if (!existsSync(path)) {
    continue;
  }
  const file = JSON.parse(readFileSync(path, "utf8")) as LandmarkFile;
  for (const lm of file.landmarks) {
    landmarkIds.add(lm.id);
  }
}
const ids = [...landmarkIds].sort();
const raw = await entities(ids, "claims|labels|descriptions|sitelinks");
const named = [...new Set(Object.values(raw).flatMap(referencedItems))];
const labels: Record<string, string> = {};
for (const [id, e] of Object.entries(await entities(named, "labels"))) {
  const label = labelOf(e);
  if (label) {
    labels[id] = label;
  }
}
const facts: Record<string, WikidataFacts> = {};
for (const id of ids) {
  const e = raw[id];
  if (e?.labels) {
    facts[id] = wikidataFacts(e, labels);
  }
}
const out: WikidataFile = {
  attribution: "Wikidata (CC0)",
  retrieved: new Date().toISOString().slice(0, 10),
  entities: facts,
};
const dest = join(ROOT, siteDataDir(site), WIKIDATA_FACTS_FILE);
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`);
process.stdout.write(
  `${site.id}: ${Object.keys(facts).length} of ${ids.length} landmarks → ${dest}\n`
);
