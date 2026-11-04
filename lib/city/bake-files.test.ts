import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { SITES } from "../../sites";
import { directImports } from "../../scripts/bake-sources";
import { bakeFileProblems, parseBakeFile } from "./bake-file";
import type { BakeFile } from "./bake-file";
import type { FacadeMaterial } from "./building-tint";
import type { WallMaterial } from "./city-mesh";
import type { FountainStyle, MonumentForm, MonumentKind } from "./features";
import { LANDMARK_FACTS_FILE_SPEC } from "./landmark-facts-file";
import { landmarkFactsSource } from "./landmark-facts";
import { LANDMARKS_FILE } from "./landmarks-file";
import type {
  FOUNTAIN_STYLES,
  MONUMENT_FORMS,
  MONUMENT_KINDS,
} from "./monuments-file";
import { MONUMENTS_FILE } from "./monuments-file";
import { muralsSource } from "./murals";
import { MURALS_FILE_SPEC } from "./murals-file";
import type { FACADE_MATERIALS, WALL_MATERIALS } from "./osm-buildings-file";
import { OSM_BUILDINGS_FILE } from "./osm-buildings-file";
import { ROOF_COLOURS_FILE } from "./roof-colours-file";
import type { Site } from "./site";
import {
  cityMeshSourceFiles,
  siteDataDir,
  sideFileSource,
  tileArtifacts,
  tileIds,
} from "./tile";
import { tramTimetableSource } from "./tram-timetable";
import type { TramDayKind } from "./tram-timetable";
import type { TRAM_DAY_KINDS } from "./tram-timetable-file";
import { TRAMS_FILE } from "./tram-timetable-file";

// Every committed file a bake hands over to TypeScript, parsed by its one
// schema (ADR 0059): a key the bake renames, a number it turns into a
// string, a member it drops fails here, not as a silently poorer layer.
const ROOT = nodePath.join(import.meta.dir, "..", "..");
const sites: Site[] = Object.values(SITES);

/** The committed files `pathOf` names, per tile or per site. */
const perTile = (pathOf: (site: Site, tile: string) => string) =>
  sites.flatMap((site) =>
    tileIds(site)
      .map((tile) => pathOf(site, tile))
      .filter((p) => existsSync(nodePath.join(ROOT, p)))
  );
const perSite = (pathOf: (dataDir: string) => string) =>
  sites
    .map((site) => pathOf(siteDataDir(site)))
    .filter((p) => existsSync(nodePath.join(ROOT, p)));

const SPECS: [BakeFile, string[]][] = [
  [LANDMARK_FACTS_FILE_SPEC, perSite(landmarkFactsSource)],
  [LANDMARKS_FILE, perTile((s, t) => cityMeshSourceFiles(s, t).landmarks)],
  [OSM_BUILDINGS_FILE, perTile((s, t) => cityMeshSourceFiles(s, t).osmBuild)],
  [
    MONUMENTS_FILE,
    perTile((s, t) => sideFileSource(s, tileArtifacts(t).monuments.file)),
  ],
  [MURALS_FILE_SPEC, perSite(muralsSource)],
  [TRAMS_FILE, perSite(tramTimetableSource)],
  [ROOF_COLOURS_FILE, perTile((s, t) => cityMeshSourceFiles(s, t).roofColor)],
];

const cases = SPECS.flatMap(([spec, files]) =>
  files.map((file) => [file, spec] as const)
);

test("every spec finds Dresden's committed file", () => {
  for (const [spec, files] of SPECS) {
    expect([spec.file, files.some((f) => f.includes("/dresden/"))]).toEqual([
      spec.file,
      true,
    ]);
  }
});

test.each(cases)("%s matches its schema", (file, spec) => {
  const json: unknown = JSON.parse(
    readFileSync(nodePath.join(ROOT, file), "utf-8")
  );
  expect(bakeFileProblems(spec, json)).toEqual([]);
  // no transform, default or stripped key: what it accepts it returns
  expect(spec.schema.parse(json)).toEqual(json);
});

test("a file that does not match fails naming the file, the writer and the step", () => {
  const where = "data/dresden/dlm/landmarks_33412_5656_2_sn.json";
  const entry = { id: "Q1", links: "3", name: "x", objects: [], x: 0, y: 0 };
  const bad = { attribution: "", landmarks: [entry], extra: 1 };
  expect(() => parseBakeFile(LANDMARKS_FILE, bad, where)).toThrow(
    /landmarks_33412_5656_2_sn\.json does not match lib\/city\/landmarks-file\.ts \(written by pipeline\/bake\/landmarks\.py\):\n✖ Invalid input: expected number, received string\n {2}→ at landmarks\[0\]\.links\n✖ Unrecognized key: "extra"\nRe-bake it \(bun run bake dresden --step landmarks\)/u
  );
  // and a matching one comes back as itself, keys in its own order
  const good = { landmarks: [], attribution: "" };
  expect(Object.keys(parseBakeFile(LANDMARKS_FILE, good, where))).toEqual([
    "landmarks",
    "attribution",
  ]);
});

/** Whether two unions hold the same members (each is assignable to the
 *  other, unwrapped so neither distributes). */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Member<L extends readonly string[]> = L[number];

test("each schema's list is the viewer's union, member for member", () => {
  const equal: [
    Equal<Member<typeof WALL_MATERIALS>, WallMaterial>,
    Equal<Member<typeof FACADE_MATERIALS>, FacadeMaterial>,
    Equal<Member<typeof MONUMENT_KINDS>, MonumentKind>,
    Equal<Member<typeof MONUMENT_FORMS>, MonumentForm>,
    Equal<Member<typeof FOUNTAIN_STYLES>, FountainStyle>,
    Equal<Member<typeof TRAM_DAY_KINDS>, TramDayKind>,
  ] = [true, true, true, true, true, true];
  expect(equal.every(Boolean)).toBe(true);
});

// zod is in no first-load chunk (ADR 0047): only the Frag-die-Stadt tools
// and the schema modules import it, and the viewer takes their types only.
const SCHEMA_MODULE = /^lib\/city\/(?:bake-file|[\w-]+-file)\.ts$/u;
const ZOD_IMPORTERS = new Set(["lib/city/ask-tools.ts"]);

function sourcesUnder(dir: string): string[] {
  return readdirSync(nodePath.join(ROOT, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (e) =>
        e.isFile() && /\.tsx?$/u.test(e.name) && !/\.test\.tsx?$/u.test(e.name)
    )
    .map((e) => nodePath.relative(ROOT, nodePath.join(e.parentPath, e.name)));
}

test("the viewer imports zod and the schema modules by type only", () => {
  const viewer = [
    ...sourcesUnder("app"),
    ...sourcesUnder("lib/city").filter(
      (p) => !p.includes("/", "lib/city/".length) && !SCHEMA_MODULE.test(p)
    ),
  ].filter((p) => !ZOD_IMPORTERS.has(p));
  const offending = viewer.flatMap((p) => {
    const text = readFileSync(nodePath.join(ROOT, p), "utf-8");
    const zod = /from ["']zod(?:\/[^"']*)?["']/u.test(text)
      ? [`${p}: zod`]
      : [];
    const schemas = directImports(p, ROOT)
      .filter((i) => SCHEMA_MODULE.test(i))
      .map((i) => `${p}: ${i}`);
    return [...zod, ...schemas];
  });
  expect(offending).toEqual([]);
});
