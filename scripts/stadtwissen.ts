/**
 * `bun scripts/stadtwissen.ts <site> <command> …`: the Stadtwissen
 * (lib/city/stadtwissen.ts) from the command line — for a walk's author and
 * for agents in the workshop. Reads what `bun dev`/`bun run build` published
 * under `public/data/<site>/`.
 *
 *   such <words…>         landmarks, monuments and buildings by name or address
 *   nah <x> <y> [radius]  what stands within radius m (default 80) of a point
 *   wahrzeichen [words…]  the landmarks with Wikidata's facts, most notable first
 *   quellen               who publishes the facts, under which licence
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  matchesQuery,
  nearby,
  STADTWISSEN_FILE,
  type StadtwissenIndex,
  WIKIDATA_PROPERTIES,
  type WikidataProperty,
  type WissenBuilding,
  type WissenLandmark,
  type WissenMonument,
  type WissenTile,
  wikipediaUrl,
} from "../lib/city/stadtwissen";
import { siteFromArgs } from "../sites";

const { site, rest } = siteFromArgs(process.argv.slice(2));
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
const tiles = (): WissenTile[] =>
  index.tiles.map((t) => read<WissenTile>(t.file));
const buildings = (): WissenBuilding[] => tiles().flatMap((t) => t.buildings);
const monuments = (): WissenMonument[] => tiles().flatMap((t) => t.monuments);
const monument = (m: WissenMonument & { d?: number }) =>
  `${m.d === undefined ? "" : `${Math.round(m.d)} m  `}${m.name} · ${m.kind}${m.material ? `, ${m.material}` : ""} · (${m.x}, ${m.y})${m.wd ? ` · ${m.wd}` : ""} · ${m.id}`;

const out = (line: string) => process.stdout.write(`${line}\n`);

function building(b: WissenBuilding & { d?: number }): string {
  const what = [
    b.use,
    b.roof,
    b.h ? `${b.h} m` : "",
    b.levels ? `${b.levels} Geschosse` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const flags = [b.heritage ? "Denkmal" : "", b.shop ? "Laden" : "", b.wd ?? ""]
    .filter(Boolean)
    .join(" ");
  const d = b.d === undefined ? "" : `${Math.round(b.d)} m  `;
  return `${d}${b.name ?? "—"} · ${b.addr ?? ""} · (${b.x}, ${b.y}, z ${b.z}) · ${what}${flags ? ` · ${flags}` : ""} · ${b.id}`;
}

function landmark(lm: WissenLandmark & { d?: number }): string[] {
  const d = lm.d === undefined ? "" : `${Math.round(lm.d)} m  `;
  const lines = [
    `${d}${lm.name} (${lm.id}) · (${lm.x}, ${lm.y}, z ${lm.z ?? "?"}) · ${lm.h} m · ${lm.links} Artikel`,
  ];
  const f = lm.facts;
  if (f?.description) {
    lines.push(`    ${f.description}`);
  }
  for (const [p, values] of Object.entries(f?.claims ?? {})) {
    const label = WIKIDATA_PROPERTIES[p as WikidataProperty];
    lines.push(`    ${label}: ${(values ?? []).map((v) => v.v).join("; ")}`);
  }
  if (f?.wiki) {
    lines.push(`    ${wikipediaUrl(f.wiki)}`);
  }
  return lines;
}

const [command, ...args] = rest;
switch (command) {
  case "such": {
    const q = args.join(" ");
    index.landmarks
      .filter((lm) => matchesQuery(lm, q))
      .flatMap(landmark)
      .forEach(out);
    monuments()
      .filter((m) => matchesQuery(m, q))
      .forEach((m) => out(monument(m)));
    buildings()
      .filter((b) => matchesQuery(b, q))
      .slice(0, 40)
      .forEach((b) => out(building(b)));
    break;
  }
  case "nah": {
    const [x, y, r = "80"] = args.map(Number);
    nearby(index.landmarks, x, y, Number(r) * 3)
      .flatMap(landmark)
      .forEach(out);
    nearby(monuments(), x, y, Number(r)).forEach((m) => out(monument(m)));
    nearby(
      buildings().filter((b) => b.name !== undefined || b.wd !== undefined),
      x,
      y,
      Number(r)
    ).forEach((b) => out(building(b)));
    break;
  }
  case "wahrzeichen": {
    const q = args.join(" ");
    index.landmarks
      .filter((lm) => !q || matchesQuery(lm, q))
      .flatMap(landmark)
      .forEach(out);
    break;
  }
  case "quellen":
    for (const [key, s] of Object.entries(index.sources)) {
      out(
        `${key}: ${s?.label} · ${s?.licence} · ${s?.credit}${s?.stand ? ` · Stand ${s.stand}` : ""}`
      );
    }
    break;
  default:
    out(
      "such <Wörter> | nah <x> <y> [Radius] | wahrzeichen [Wörter] | quellen"
    );
}
