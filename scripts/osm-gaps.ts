/**
 * `bun scripts/osm-gaps.ts <site> [--top N]`: OSM-Lücken als Aufgaben
 * (lib/city/osm-gaps.ts, docs/routines.md). Reads the site's Stadtwissen
 * as `bun dev`/`bun run build` published it under `public/data/<site>/`
 * and writes, under `osm-gaps/<site>/` (gitignored), one GeoJSON per kind
 * of gap — a MapRoulette challenge's tasks — and `aufgaben.md`, the
 * counts and the first N of each kind with links to the map and the
 * editor. It never touches OpenStreetMap: mappers do.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GAP_KINDS,
  type GapKind,
  gapsGeoJson,
  osmGaps,
  osmLinks,
} from "../lib/city/osm-gaps";
import {
  STADTWISSEN_FILE,
  type StadtwissenIndex,
  type WissenTile,
} from "../lib/city/stadtwissen";
import { siteFromArgs } from "../sites";

const { site, rest } = siteFromArgs(process.argv.slice(2));
const topAt = rest.indexOf("--top");
const top = topAt >= 0 ? Number(rest[topAt + 1]) || 20 : 20;
const dir = join(import.meta.dir, "..", "public", "data", site.id);
const manifest = JSON.parse(
  readFileSync(join(dir, "manifest.json"), "utf8")
) as { files: Record<string, string> };
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
const indexFile = manifest.files[STADTWISSEN_FILE];
if (!indexFile) {
  throw new Error(`no ${STADTWISSEN_FILE} for ${site.id}: run bun dev first`);
}
const index = read<StadtwissenIndex>(indexFile);
const tasks = osmGaps(
  index,
  index.tiles.map((t) => read<WissenTile>(t.file))
);

const out = join(import.meta.dir, "..", "osm-gaps", site.id);
mkdirSync(out, { recursive: true });
const lines = [
  `# OSM-Lücken in ${site.name}`,
  "",
  "Aus dem Stadtmodell abgeleitet: wo OpenStreetMap einem Gebäude etwas",
  "nicht sagt, was das amtliche 3D-Modell oder Wikidata nahelegt. Jede",
  "Zeile ist ein Hinweis zum Prüfen, keine Gewissheit — und keine",
  "Änderung: eingetragen wird nur, was ein Mapper vor Ort oder auf",
  "zulässigen Quellen nachgesehen hat.",
  "",
];
for (const kind of Object.keys(GAP_KINDS) as GapKind[]) {
  const geo = gapsGeoJson(kind, tasks);
  writeFileSync(join(out, `${kind}.geojson`), `${JSON.stringify(geo)}\n`);
  lines.push(
    `## ${GAP_KINDS[kind].title} (${geo.features.length})`,
    "",
    GAP_KINDS[kind].instruction,
    ""
  );
  for (const t of tasks.filter((e) => e.kind === kind).slice(0, top)) {
    const links = osmLinks(t);
    lines.push(
      `- ${t.label} — [Karte](${links.karte}) · [bearbeiten](${links.editor}) · \`${t.id}\``
    );
  }
  lines.push("", `Alle als GeoJSON: \`${kind}.geojson\``, "");
}
writeFileSync(join(out, "aufgaben.md"), lines.join("\n"));
process.stdout.write(
  `${tasks.length} Aufgaben in ${out}: ${(Object.keys(GAP_KINDS) as GapKind[])
    .map((k) => `${k} ${tasks.filter((t) => t.kind === k).length}`)
    .join(", ")}\n`
);
