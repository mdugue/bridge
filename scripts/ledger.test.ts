import { afterAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { gzipSync } from "node:zlib";
import {
  RASTER_KINDS,
  REACH_KINDS,
  rasterFiles,
} from "../app/_components/tile-rasters";
import type { RasterKind } from "../app/_components/tile-rasters";
import type { Ledger } from "../lib/city/ledger";
import { VARIANT_KINDS } from "../lib/city/ledger-rasters";
import { COARSE_DRESSING_KINDS, DRESSING_KINDS } from "../lib/city/tile";
import { buildTileset } from "../lib/city/tileset";
import type {
  BakedTile,
  ContentExtras,
  TerrainFiles,
} from "../lib/city/tileset";
import {
  FLAGS,
  LEDGER_FILE,
  LEDGER_PATH,
  main,
  measure,
  measureRasters,
  publishedFiles,
  run,
  viewerReads,
} from "./ledger";
import { measureDressing } from "./ledger-dressing";

/* -------------------------------------------- the viewer's rule, and ours */

/** A fine level's extras as the tileset names them (published names). */
const FINE = {
  landcover: "landcover.png",
  landcoverLow: "landcover.r2048.png",
  ndvi: "ndvi.png",
  surface: "surface.png",
  surfaceFar: "surface.r1024.png",
  edges: "edges.png",
  edgesFar: "edges.r1024.png",
  sport: "sport.png",
  sportFar: "sport.r1024.png",
  sportTable: "sport.json",
  cultivated: "cultivated.png",
  cultivatedLow: "cultivated.low.png",
  markings: "markings.png",
  markingsLow: "markings_low.png",
  markingsTable: "markings.json",
  svf: "svf.png",
  horizon: "horizon.png",
};

test("beyond the reach a level reads the twins, within it the full rasters", () => {
  expect(viewerReads(FINE, 0, false, "beyond").toSorted()).toEqual(
    [
      "cultivated.low.png",
      "edges.r1024.png",
      "horizon.png",
      "landcover.png",
      "markings.json",
      "markings_low.png",
      "ndvi.png",
      "sport.json",
      "sport.r1024.png",
      "surface.r1024.png",
      "svf.png",
    ].toSorted()
  );
  expect(viewerReads(FINE, 0, false, "within").toSorted()).toEqual(
    [
      "cultivated.png",
      "edges.png",
      "horizon.png",
      "landcover.png",
      "markings.json",
      "markings.png",
      "ndvi.png",
      "sport.json",
      "sport.png",
      "surface.png",
      "svf.png",
    ].toSorted()
  );
});

test("a phone reads its own twins at either reach, and no sports raster", () => {
  const beyond = viewerReads(FINE, 0, true, "beyond");
  const within = viewerReads(FINE, 0, true, "within");
  for (const reads of [beyond, within]) {
    expect(reads).toContain("landcover.r2048.png");
    expect(reads).toContain("markings_low.png");
    expect(reads).toContain("cultivated.low.png");
    expect(reads).not.toContain("landcover.png");
    expect(reads).not.toContain("sport.png");
    expect(reads).not.toContain("sport.r1024.png");
  }
  expect(beyond).toContain("surface.r1024.png");
  expect(within).toContain("surface.png");
  // a coarse level reads no sports grounds on a phone
  expect(viewerReads(FINE, 1, true, "within")).not.toContain("sport.png");
});

const source = (path: string) =>
  readFileSync(nodePath.join(import.meta.dir, "..", path), "utf-8");

/** A function's text in a module: from its head to the next top-level
 *  closing brace. */
const functionText = (text: string, name: string): string => {
  const start = text.search(
    new RegExp(`^(?:export )?(?:async )?function\\*? ${name}\\b`, "mu")
  );
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
};

/** The kinds a function acquires, each with whether it hands `how` (the
 *  reach) on. */
const acquired = (body: string): { how: boolean; kind: string }[] =>
  [
    ...body.matchAll(
      /hold\.acquire\(\s*"(?<kind>\w+)",\s*(?:d\.)?extras,\s*(?:d\.)?signal(?<how>,\s*how)?\s*\)/gu
    ),
  ].map((m) => ({
    kind: m.groups?.kind ?? "",
    how: m.groups?.how !== undefined,
  }));

test("the ledger's reads are the rasters terrain-layer.ts acquires", () => {
  const text = source("app/_components/terrain-layer.ts");
  const load = functionText(text, "loadTerrainRasters");
  const swap = functionText(text, "loadReachSet");
  // every acquire of the module is in one of the two, and is read here
  expect(text.match(/hold\.acquire\(/gu)?.length).toBe(
    acquired(load).length + acquired(swap).length
  );
  // a level acquires every kind of the table: what `viewerReads` walks
  expect(
    acquired(load)
      .map((a) => a.kind)
      .toSorted()
  ).toEqual(Object.keys(RASTER_KINDS).toSorted());
  // the kinds it hands the reach to are the ledger's `REACH_KINDS`, and the
  // reach is `far` alone
  expect(
    acquired(load)
      .filter((a) => a.how)
      .map((a) => a.kind)
  ).toEqual([...REACH_KINDS]);
  expect(load).toContain("const how = { far };");
  // approaching swaps those kinds, and no other
  expect(acquired(swap)).toEqual(
    REACH_KINDS.map((kind) => ({ kind, how: true }))
  );
  expect(swap).toContain("const how = { far, now: true };");
});

test("the ledger's reads go through the viewer's rasterFiles, kind by kind", () => {
  const extras = { ...FINE, level: 0 } as unknown as ContentExtras;
  const follows: readonly string[] = REACH_KINDS;
  for (const phone of [false, true]) {
    for (const reach of ["beyond", "within"] as const) {
      const expected = (Object.keys(RASTER_KINDS) as RasterKind[]).flatMap(
        (kind) => {
          const files = rasterFiles(
            extras,
            kind,
            phone,
            reach === "beyond" && follows.includes(kind)
          );
          return files ? [files.raster, files.table ?? ""] : [];
        }
      );
      expect(viewerReads(FINE, 0, phone, reach).toSorted()).toEqual(
        expected.filter((f) => f !== "").toSorted()
      );
    }
  }
});

test("the fine set's side files are those tile-stream.ts fetches", () => {
  const text = source("app/_components/tile-stream.ts");
  const fine = functionText(text, "buildDressing");
  const kinds = [
    ...fine.matchAll(/\bget(?:<\w+>)?\(\s*"(?<kind>\w+)"\s*\)/gu),
    ...fine.matchAll(/\bfetchPack\(d\.(?<kind>\w+),/gu),
  ].map((m) => m.groups?.kind ?? "");
  // each dressing kind is fetched, once: the set counts every one of them
  expect(kinds.toSorted()).toEqual([...DRESSING_KINDS].toSorted());
  // and beside them the sports table, on every tier
  expect(fine).toContain(
    "fetchOptionalJson<SportTable>(url(extras.sportTable)"
  );
  // no raster is read for the dressing: the trees come placed
  expect(fine).not.toContain("extras.ndvi");
  // the coarse level's dressing file, read too: it is the set `far`'s
  // (lib/city/ledger.ts `tileSet`)
  expect(fine).toContain("fetchPack(extras.coarseDressing, url, signal)");
  // the coarse level's side files, all of them
  const coarse = functionText(text, "buildCoarseDressing");
  expect(
    [...coarse.matchAll(/\bfiles\.(?<kind>\w+)\b/gu)]
      .map((m) => m.groups?.kind ?? "")
      .filter((kind, i, all) => all.indexOf(kind) === i)
      .toSorted()
  ).toEqual([...COARSE_DRESSING_KINDS].toSorted());
});

test("the raster table's program key follows terrain-layer.ts splatVariant", () => {
  const text = source("app/_components/terrain-layer.ts");
  const body = text.slice(
    text.indexOf("const splatVariant"),
    text.indexOf("...splatSize(splat)")
  );
  const kinds = [...body.matchAll(/splat\.(?<kind>\w+) \?/gu)].map((m) =>
    (m.groups?.kind ?? "").replace(/Texture$/u, "")
  );
  expect(kinds).toEqual([...VARIANT_KINDS]);
});

test("the ledger is committed", () => {
  expect(existsSync(LEDGER_FILE)).toBe(true);
  expect(LEDGER_FILE.endsWith(LEDGER_PATH)).toBe(true);
});

/* ------------------------------------------------ a fixture site, end to end */

/** A binary glTF of `triangles` triangles, gzipped as the build serves it. */
const glbGz = (triangles: number): Uint8Array => {
  const text = new TextEncoder().encode(
    JSON.stringify({
      accessors: [{ componentType: 5126, count: triangles * 3, type: "VEC3" }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    })
  );
  const padded = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(20 + padded).fill(0x20, 20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e_4f_53_4a, true);
  out.set(text, 20);
  return new Uint8Array(gzipSync(out));
};

const level = (t: string, n: 0 | 1): TerrainFiles => ({
  landcover: `landcover_${t}_${n}.png`,
  landcoverLow: n === 0 ? `landcover_${t}.r2048.png` : `landcover_${t}_1.png`,
  svf: `svf_${t}.png`,
  ...(n === 0
    ? {
        surface: `surface_${t}.png`,
        surfaceFar: `surface_${t}.r1024.png`,
        dressing: { lamps: `lamps_${t}.geojson` },
      }
    : { coarse: { dressingCoarse: `crowns_${t}.json` } }),
});

const baked = (t: string, x: number): BakedTile => ({
  id: t,
  bounds: [x, 0, x + 2000, 2000],
  zRange: [100, 150],
  city: `city_${t}.glb.gz`,
  cityFar: `city_${t}_far.glb.gz`,
  terrain: { 0: `terrain_${t}_l0.glb.gz`, 1: `terrain_${t}_l1.glb.gz` },
  files: {
    city: { facades: `facades_${t}.json` },
    terrain: { 0: level(t, 0), 1: level(t, 1) },
  },
});

const TILES = ["a", "b"];
const SITE = "test";

/** `bytes` bytes that gzip to about as many: a text's size is then told
 *  from its wire size. */
const noise = (bytes: number, seed: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  let state = seed + 1;
  for (let i = 0; i < bytes; i += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) % 4_294_967_296;
    out[i] = 33 + (Math.abs(Math.floor(state / 65_536)) % 90);
  }
  return out;
};

/** The fixture's boot: its longest function. */
const BOOT =
  "// boots\nexport function bootApp() {\n  a();\n  b();\n  c();\n  return 1;\n}\n";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A repository in small: one published site of two tiles, and the
 *  sources the counters read. */
function fixture(): { data: string; root: string } {
  const root = mkdtempSync(nodePath.join(tmpdir(), "ledger-test-"));
  roots.push(root);
  const data = nodePath.join(root, "public/data", SITE);
  for (const dir of [
    data,
    nodePath.join(root, "qa"),
    nodePath.join(root, "app/_components"),
    nodePath.join(root, "pipeline/bake"),
    nodePath.join(root, "docs"),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  const tileset = buildTileset(
    TILES.map((t, i) => baked(t, i * 2000)),
    {
      epsg: 25_833,
      offset: { cx: 2000, cy: 1000 },
      site: SITE,
      tiles: TILES.map((id, i) => ({
        id,
        bounds: [i * 2000, 0, i * 2000 + 2000, 2000],
        footprints: `footprints_${id}.json`,
      })),
    }
  );
  const files: Record<string, Uint8Array> = {
    "tileset.json": new TextEncoder().encode(JSON.stringify(tileset)),
    "trams.json": noise(300, 1),
    "stadtwissen.json": new TextEncoder().encode(" ".repeat(5000)),
  };
  for (const [i, t] of TILES.entries()) {
    const big = i + 1;
    Object.assign(files, {
      [`city_${t}.glb.gz`]: glbGz(10 * big),
      [`city_${t}_far.glb.gz`]: glbGz(2 * big),
      [`terrain_${t}_l0.glb.gz`]: noise(400 * big, 2),
      [`terrain_${t}_l1.glb.gz`]: noise(100 * big, 3),
      [`facades_${t}.json`]: noise(50, 4),
      [`landcover_${t}_0.png`]: noise(4000, 5),
      [`landcover_${t}.r2048.png`]: noise(1000, 6),
      [`landcover_${t}_1.png`]: noise(500, 7),
      [`svf_${t}.png`]: noise(200, 8),
      [`surface_${t}.png`]: noise(3000, 9),
      [`surface_${t}.r1024.png`]: noise(700, 10),
      [`lamps_${t}.geojson`]: noise(600 * big, 11),
      [`crowns_${t}.json`]: noise(80, 12),
      [`footprints_${t}.json`]: noise(60, 13),
    });
  }
  const manifest = { version: 1, files: {} as Record<string, string> };
  for (const [logical, bytes] of Object.entries(files)) {
    // the tileset names its tiles' files as they are served; the manifest
    // finds the tileset under its hashed name
    const served =
      logical === "tileset.json" ? "tileset.0a1b2c3d.json" : logical;
    manifest.files[logical] = served;
    writeFileSync(nodePath.join(data, served), bytes);
  }
  writeFileSync(
    nodePath.join(data, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  writeFileSync(nodePath.join(data, "site-stats.json"), "{}");
  writeFileSync(nodePath.join(root, "app/_components/create-app.ts"), BOOT);
  writeFileSync(
    nodePath.join(root, "app/_components/tree-layer.ts"),
    "// An upstream workaround\nexport const tree = 1;\n"
  );
  // a layer in a package, as JSX; and one in a dependency, which is none
  mkdirSync(nodePath.join(root, "packages/viewer/node_modules/dep"), {
    recursive: true,
  });
  writeFileSync(
    nodePath.join(root, "packages/viewer/sky-layer.tsx"),
    "export const Sky = () => (\n  <p>\n    It's {1} (\n  </p>\n);\n"
  );
  writeFileSync(
    nodePath.join(root, "packages/viewer/node_modules/dep/dep-layer.ts"),
    "export function huge() {\n  a();\n  b();\n  c();\n  d();\n  e();\n  f();\n}\n"
  );
  writeFileSync(
    nodePath.join(root, "pipeline/bake/trees.py"),
    "x = owns(b, 1, 2)\n"
  );
  writeFileSync(
    nodePath.join(root, "docs/rendering.md"),
    "## Workarounds for upstream bugs\n\n**three: one.** Text.\n"
  );
  return { root, data };
}

/** Runs the script on a fixture, collecting its report. */
const runOn = async (root: string, argv: string[], today = "2026-11-16") => {
  let report = "";
  const code = await run(argv, {
    root,
    site: SITE,
    today,
    out: (text) => {
      report += text;
    },
  });
  return { code, report };
};

const ledgerOf = (root: string) =>
  readFileSync(nodePath.join(root, LEDGER_PATH), "utf-8");

/** A served file of the fixture, rewritten by `change`. */
const rewrite = (
  data: string,
  logical: string,
  change: (bytes: Uint8Array) => Uint8Array | string
) => {
  const { files } = publishedFiles(SITE, nodePath.join(data, "../../.."));
  const served = files[logical] ?? logical;
  const path = nodePath.join(data, served);
  writeFileSync(path, change(new Uint8Array(readFileSync(path))));
};

const grown = (by: number) => (bytes: Uint8Array) =>
  new Uint8Array([...bytes, ...noise(by, 99)]);

test("the figures of a fixture site, each from the files it names", () => {
  const { root, data } = fixture();
  const ledger = measure(SITE, root);
  const gz = (logical: string) => {
    const { files, read } = publishedFiles(SITE, root);
    return gzipSync(read(files[logical] ?? logical), { level: 6 }).length;
  };
  expect(ledger.version).toBe(2);
  expect(ledger.site).toBe(SITE);
  expect(ledger.tiles).toBe(2);
  const near = glbGz(10).length;
  const far = glbGz(2).length;
  // the spawn tile, a: the far buildings, the facade reading (text, on the
  // wire gzipped), the coarse terrain, its class raster, sky view, crowns
  expect(ledger.bytes.far.spawn).toEqual({
    tile: "a",
    bytes: far + gz("facades_a.json") + 100 + 500 + 200 + gz("crowns_a.json"),
    files: 6,
  });
  expect(ledger.bytes.far.phone).toBeUndefined();
  // its fine level beyond the reach: the paving's twin
  const fine = 400 + 4000 + 200 + gz("lamps_a.geojson");
  expect(ledger.bytes.fine.spawn).toEqual({
    tile: "a",
    bytes: fine + 700,
    files: 5,
  });
  // approached: the full paving on top
  expect(ledger.bytes.approached.spawn).toEqual({
    tile: "a",
    bytes: fine + 700 + 3000,
    files: 6,
  });
  // a phone: the class raster's twin in place of the full one
  expect(ledger.bytes.fine.phone?.spawn).toEqual({
    tile: "a",
    bytes: fine - 4000 + 1000 + 700,
    files: 5,
  });
  expect(ledger.bytes.approached.phone?.spawn.bytes).toBe(
    fine - 4000 + 1000 + 700 + 3000
  );
  expect(ledger.bytes.near.spawn).toEqual({ tile: "a", bytes: near, files: 1 });
  expect(ledger.bytes.near.largest.tile).toBe("b");
  expect(ledger.bytes.near.site.files).toBe(2);
  expect(ledger.bytes.ask.site).toEqual({ bytes: 0, files: 0 });
  expect(ledger.bytes.all.spawn.files).toBe(14);
  // every file of the directory in one class
  expect(ledger.published.files).toBe(33);
  expect(ledger.published.tiles).toEqual(ledger.bytes.all.site);
  expect(ledger.published.tiles.files).toBe(28);
  expect(ledger.published.boot).toEqual({
    bytes: gz("manifest.json") + gz("tileset.json"),
    files: 2,
  });
  expect(ledger.published.site).toEqual({ bytes: gz("trams.json"), files: 1 });
  // the server's two, on disk: 5000 spaces would gzip to nothing
  expect(ledger.published.server).toEqual({ bytes: 5002, files: 2 });
  expect(ledger.buildings.near.a).toEqual({
    vertices: 30,
    triangles: 10,
    accessorBytes: 360,
  });
  expect(ledger.buildings.far.b?.triangles).toBe(4);
  expect(ledger.counters).toEqual({
    dressingKinds: DRESSING_KINDS.length,
    coarseDressingKinds: COARSE_DRESSING_KINDS.length,
    askKinds: 1,
    publishedExtensions: [".geojson", ".glb.gz", ".json", ".png"],
    layerModules: { files: 2, codeLines: 6 },
    longestFunction: {
      lines: 6,
      name: "bootApp",
      path: "app/_components/create-app.ts",
    },
    bakeSeamModules: {
      matching: 1,
      of: 1,
      ways: {
        osmMargin: 0,
        readMargin: 0,
        owns: 1,
        neighbourRasters: 0,
        neighbourFiles: 0,
        siteMemo: 0,
      },
    },
    upstreamWorkarounds: { entries: 1, sites: 1 },
  });
  expect(existsSync(nodePath.join(data, "manifest.json"))).toBe(true);
});

test("a write, then a check that holds; a second write is the same file", async () => {
  const { root } = fixture();
  const none = await runOn(root, ["--check"]);
  expect(none.code).toBe(1);
  expect(existsSync(nodePath.join(root, LEDGER_PATH))).toBe(false);
  const wrote = await runOn(root, []);
  expect(wrote).toEqual({ code: 0, report: "qa/ledger.json (2026-11-16)\n" });
  const written = ledgerOf(root);
  const ledger = JSON.parse(written) as Ledger;
  expect(ledger.dated).toBe("2026-11-16");
  expect(ledger).toEqual({
    ...measure(SITE, root),
    rasters: await measureRasters(root),
    dressing: measureDressing(SITE, root, publishedFiles, {
      committed: null,
      today: "2026-11-16",
    }),
    dated: "2026-11-16",
  });
  expect(Object.keys(ledger).slice(0, 5)).toEqual([
    "version",
    "site",
    "dated",
    "wire",
    "tiles",
  ]);
  expect(written.endsWith("}\n")).toBe(true);
  // written as the formatter leaves it: the lint's check finds nothing
  const formatted = Bun.spawnSync(
    [
      nodePath.join(import.meta.dir, "../node_modules/.bin/oxfmt"),
      "--check",
      nodePath.join(root, LEDGER_PATH),
    ],
    { cwd: nodePath.join(import.meta.dir, "..") }
  );
  expect(formatted.exitCode).toBe(0);
  expect(written).not.toBe(`${JSON.stringify(ledger, null, 2)}\n`);
  expect(await runOn(root, ["--check"], "2027-01-01")).toEqual({
    code: 0,
    report:
      "the browser figures were not compared (no --browser)\nqa/ledger.json holds\n",
  });
  // another day, the same figures: the same bytes
  const again = await runOn(root, [], "2027-01-01");
  expect(again.report).toBe("qa/ledger.json (2026-11-16)\n");
  expect(ledgerOf(root)).toBe(written);
});

test("a ledger written without a day given is dated today", async () => {
  const { root } = fixture();
  let report = "";
  const code = await run([], {
    root,
    site: SITE,
    out: (text) => {
      report += text;
    },
  });
  const today = new Date().toISOString().slice(0, 10);
  expect({ code, report }).toEqual({
    code: 0,
    report: `qa/ledger.json (${today})\n`,
  });
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
});

test("an argument the script does not know is refused, nothing written", async () => {
  const { root } = fixture();
  for (const argv of [["--chek"], ["--check", "--now"], ["check"], [""]]) {
    const { code, report } = await runOn(root, argv);
    expect(code).toBe(2);
    expect(report).toContain("unknown argument");
    expect(existsSync(nodePath.join(root, LEDGER_PATH))).toBe(false);
  }
  expect([...FLAGS]).toEqual(["--check", "--browser"]);
  // the script itself, as CI starts it: the code is the process's
  const script = Bun.spawnSync(["bun", "scripts/ledger.ts", "--chek"], {
    cwd: nodePath.join(import.meta.dir, ".."),
  });
  expect(script.exitCode).toBe(2);
  expect(script.stdout.toString()).toContain("unknown argument --chek");
});

/** A fixture with its ledger written, then changed by `change`: what
 *  `--check` says, and that it wrote nothing. */
const checkAfter = async (
  change: (at: { data: string; root: string }) => void
) => {
  const at = fixture();
  await runOn(at.root, []);
  const written = ledgerOf(at.root);
  change(at);
  const checked = await runOn(at.root, ["--check"], "2027-01-01");
  expect(ledgerOf(at.root)).toBe(written);
  return {
    ...checked,
    differs: checked.report
      .split("\n")
      .filter((line) => line.startsWith("differs: "))
      .map((line) => line.slice("differs: ".length).split(":")[0] ?? ""),
  };
};

test("a dressing file that grew fails the check, by its figures' names", async () => {
  const was = measure(SITE, fixture().root).bytes.fine.spawn.bytes;
  const { code, report, differs } = await checkAfter(({ data }) =>
    rewrite(data, "lamps_a.geojson", grown(220_000))
  );
  expect(code).toBe(1);
  expect(differs).toEqual([
    "bytes.all.largest.bytes",
    "bytes.all.largest.tile",
    "bytes.all.median.bytes",
    "bytes.all.median.tile",
    "bytes.all.site.bytes",
    "bytes.all.spawn.bytes",
    "bytes.approached.largest.bytes",
    "bytes.approached.largest.tile",
    "bytes.approached.median.bytes",
    "bytes.approached.median.tile",
    "bytes.approached.phone.largest.bytes",
    "bytes.approached.phone.largest.tile",
    "bytes.approached.phone.median.bytes",
    "bytes.approached.phone.median.tile",
    "bytes.approached.phone.site.bytes",
    "bytes.approached.phone.spawn.bytes",
    "bytes.approached.site.bytes",
    "bytes.approached.spawn.bytes",
    "bytes.fine.largest.bytes",
    "bytes.fine.largest.tile",
    "bytes.fine.median.bytes",
    "bytes.fine.median.tile",
    "bytes.fine.phone.largest.bytes",
    "bytes.fine.phone.largest.tile",
    "bytes.fine.phone.median.bytes",
    "bytes.fine.phone.median.tile",
    "bytes.fine.phone.site.bytes",
    "bytes.fine.phone.spawn.bytes",
    "bytes.fine.site.bytes",
    "bytes.fine.spawn.bytes",
    "published.tiles.bytes",
  ]);
  expect(report).toMatch(
    new RegExp(`differs: bytes\\.fine\\.spawn\\.bytes: ${was} → \\d{6}\\n`, "u")
  );
  expect(report).toContain(
    "31 figures differ: run bun scripts/ledger.ts and commit qa/ledger.json\n"
  );
  expect(report).toContain(
    `platform: here ${process.platform}-${process.arch}, Bun ${Bun.version}\n`
  );
});

test("a file that shrank fails the check too: a saving is committed", async () => {
  const { code, differs } = await checkAfter(({ data }) =>
    rewrite(data, "terrain_a_l1.glb.gz", (bytes) => bytes.slice(0, 10))
  );
  expect(code).toBe(1);
  expect(differs).toContain("bytes.far.spawn.bytes");
  expect(differs).not.toContain("bytes.fine.spawn.bytes");
});

test("bytes moved into the manifest or the tileset do not leave the gate", async () => {
  // the manifest, fetched on every visit
  const manifest = await checkAfter(({ data }) =>
    rewrite(data, "manifest.json", (bytes) => {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as object;
      return JSON.stringify({ ...json, more: [...noise(50_000, 5)] });
    })
  );
  expect(manifest.code).toBe(1);
  expect(manifest.differs).toEqual([
    "published.boot.bytes",
    "published.kinds.manifest.bytes",
  ]);
  // a side file inlined into the tileset: the boot grows by what it held
  const inlined = await checkAfter(({ data }) =>
    rewrite(data, "tileset.json", (bytes) => {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as {
        extras: object;
      };
      json.extras = { ...json.extras, inlined: [...noise(220_000, 6)] };
      return JSON.stringify(json);
    })
  );
  expect(inlined.code).toBe(1);
  expect(inlined.differs).toEqual([
    "published.boot.bytes",
    "published.kinds.tileset.bytes",
  ]);
  expect(inlined.report).toMatch(
    /differs: published\.boot\.bytes: \d{3,4} → \d{6}\n/u
  );
});

test("a site-wide file and a server's file that grew fail the check", async () => {
  const site = await checkAfter(({ data }) =>
    rewrite(data, "trams.json", grown(1000))
  );
  expect(site.differs).toEqual([
    "published.kinds.trams.bytes",
    "published.site.bytes",
  ]);
  const server = await checkAfter(({ data }) =>
    rewrite(data, "site-stats.json", () => '{"tiles":2}')
  );
  expect(server.differs).toEqual([
    "published.kinds.site-stats.bytes",
    "published.server.bytes",
  ]);
});

test("a file published beside the manifest is an error, not a silence", async () => {
  const { root, data } = fixture();
  await runOn(root, []);
  writeFileSync(nodePath.join(data, "everything.bin.gz"), noise(5_000_000, 7));
  await expect(runOn(root, ["--check"])).rejects.toThrow(
    /in no class.*everything\.bin\.gz/u
  );
  await expect(runOn(root, [])).rejects.toThrow(/in no class/u);
});

test("a file with an extension the wire rule does not know is an error", async () => {
  const { root, data } = fixture();
  const manifestPath = nodePath.join(data, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    files: Record<string, string>;
  };
  // the buildings published raw: not what a host compresses
  const served = manifest.files["city_a.glb.gz"] ?? "";
  const raw = served.replace(/\.gz$/u, "");
  writeFileSync(nodePath.join(data, raw), noise(100, 1));
  rmSync(nodePath.join(data, served));
  const text = readFileSync(manifestPath, "utf-8").replaceAll(served, raw);
  const tilesetPath = nodePath.join(data, manifest.files["tileset.json"] ?? "");
  writeFileSync(manifestPath, text);
  writeFileSync(
    tilesetPath,
    readFileSync(tilesetPath, "utf-8").replaceAll("city_a.glb.gz", raw)
  );
  await expect(runOn(root, [])).rejects.toThrow();
});

test("the buildings' bytes and geometry are gated", async () => {
  const { code, differs } = await checkAfter(({ data }) =>
    rewrite(data, "city_a.glb.gz", () => glbGz(123_456))
  );
  expect(code).toBe(1);
  expect(differs).toContain("bytes.near.spawn.bytes");
  expect(differs).toContain("buildings.near.a.triangles");
  expect(differs).toContain("buildings.near.a.vertices");
  expect(differs).toContain("buildings.near.a.accessorBytes");
  expect(differs).not.toContain("buildings.far.a.triangles");
  const far = await checkAfter(({ data }) =>
    rewrite(data, "city_b_far.glb.gz", () => glbGz(54_321))
  );
  expect(far.differs).toContain("buildings.far.b.triangles");
  expect(far.differs).toContain("bytes.far.largest.bytes");
});

test("a phone's twin moves a phone's rows alone", async () => {
  const { differs } = await checkAfter(({ data }) =>
    rewrite(data, "landcover_a.r2048.png", grown(10))
  );
  expect(differs).toContain("bytes.fine.phone.spawn.bytes");
  expect(differs).toContain("bytes.approached.phone.spawn.bytes");
  expect(differs).toContain("bytes.all.spawn.bytes");
  expect(
    differs.filter((d) => /^bytes\.(?:fine|approached)\.(?!phone)/u.test(d))
  ).toEqual([]);
  // and the full raster a desktop's alone
  const desktop = await checkAfter(({ data }) =>
    rewrite(data, "landcover_a_0.png", grown(10))
  );
  expect(desktop.differs).toContain("bytes.fine.spawn.bytes");
  expect(desktop.differs.filter((d) => d.includes(".phone."))).toEqual([]);
});

test("a file fewer or more is a figure, with the bytes the same", async () => {
  const { differs } = await checkAfter(({ root, data }) => {
    const { files } = publishedFiles(SITE, root);
    const tilesetPath = nodePath.join(data, files["tileset.json"] ?? "");
    const tileset = readFileSync(tilesetPath, "utf-8");
    // tile b's fine level names a file of tile a's too: one request more
    writeFileSync(
      tilesetPath,
      tileset.replace(
        '"surface":"surface_b.png"',
        '"surface":"surface_b.png","horizon":"crowns_a.json"'
      )
    );
    expect(readFileSync(tilesetPath, "utf-8")).not.toBe(tileset);
  });
  expect(differs).toContain("bytes.fine.largest.files");
  expect(differs).toContain("bytes.fine.site.files");
  expect(differs).toContain("bytes.fine.phone.site.files");
  expect(differs).not.toContain("bytes.fine.spawn.files");
});

test("the counters are gated: code moves them, a comment does not", async () => {
  const code = await checkAfter(({ root }) =>
    writeFileSync(
      nodePath.join(root, "app/_components/tree-layer.ts"),
      "// An upstream workaround\nexport const tree = 1;\nexport const more = 2;\n"
    )
  );
  expect(code.differs).toEqual(["counters.layerModules.codeLines"]);
  const comment = await checkAfter(({ root }) => {
    writeFileSync(
      nodePath.join(root, "app/_components/tree-layer.ts"),
      "// An upstream workaround\n\n// more words\nexport const tree = 1;\n"
    );
    // and a move into a folder
    mkdirSync(nodePath.join(root, "app/_components/boot"));
    writeFileSync(
      nodePath.join(root, "app/_components/boot/create-app.ts"),
      BOOT
    );
    rmSync(nodePath.join(root, "app/_components/create-app.ts"));
  });
  expect(comment.differs).toEqual(["counters.longestFunction.path"]);
  const bake = await checkAfter(({ root }) => {
    mkdirSync(nodePath.join(root, "pipeline/bake/providers"));
    writeFileSync(
      nodePath.join(root, "pipeline/bake/providers/sn.py"),
      "def files(tile, margin=0):\n    pass\n"
    );
    writeFileSync(
      nodePath.join(root, "docs/rendering.md"),
      "## Workarounds for upstream bugs\n\n**three: one.** Text.\n\n**three: two.** More.\n"
    );
  });
  expect(bake.differs).toEqual([
    "counters.bakeSeamModules.matching",
    "counters.bakeSeamModules.of",
    "counters.bakeSeamModules.ways.readMargin",
    "counters.upstreamWorkarounds.entries",
  ]);
});

test("an error is the script's report, and its exit code 1", async () => {
  const { root, data } = fixture();
  let report = "";
  const out = (text: string) => {
    report += text;
  };
  expect(await main([], { root, site: "nowhere", out })).toBe(1);
  expect(report).toMatch(/^ledger: no .*nowhere.*build first.*\n$/u);
  writeFileSync(nodePath.join(data, "stray.bin.gz"), "x");
  report = "";
  expect(await main(["--check"], { root, site: SITE, out })).toBe(1);
  expect(report).toContain("in no class");
  expect(report).toContain("stray.bin.gz");
  // and what holds, holds through it
  rmSync(nodePath.join(data, "stray.bin.gz"));
  expect(await main([], { root, site: SITE, out })).toBe(0);
  expect(await main(["--check"], { root, site: SITE, out })).toBe(0);
  expect(await main(["--chek"], { root, site: SITE, out })).toBe(2);
});

test("a tile that names a file outside the sets is refused", async () => {
  const { root, data } = fixture();
  const { files } = publishedFiles(SITE, root);
  const tilesetPath = nodePath.join(data, files["tileset.json"] ?? "");
  const tileset = readFileSync(tilesetPath, "utf-8");
  // a new key on a fine level, naming a file outside the site's directory
  writeFileSync(
    tilesetPath,
    tileset.replace(
      '"surface":"surface_b.png"',
      '"surface":"surface_b.png","more":"../common/huge.png"'
    )
  );
  expect(readFileSync(tilesetPath, "utf-8")).not.toBe(tileset);
  await expect(runOn(root, [])).rejects.toThrow(
    /tile b names 1 files that no set counts.*\.\.\/common\/huge\.png/u
  );
});

test("a tileset that names a file the site does not serve is refused", async () => {
  // at the root of the full tileset, where the plate and the trams are named
  const full = fixture();
  rewrite(full.data, "tileset.json", (bytes) => {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as {
      extras: object;
    };
    json.extras = { ...json.extras, heavy: "../common/huge.png" };
    return JSON.stringify(json);
  });
  await expect(runOn(full.root, [])).rejects.toThrow(
    "tileset.json names 1 files that the site does not serve: ../common/huge.png"
  );
  // and in the lite profile's tileset, which no set reads for names
  const lite = fixture();
  const manifestPath = nodePath.join(lite.data, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    files: Record<string, string>;
  };
  manifest.files["tileset-spawn.json"] = "tileset-spawn.0a1b2c3d.json";
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const spawn = nodePath.join(lite.data, "tileset-spawn.0a1b2c3d.json");
  writeFileSync(spawn, JSON.stringify({ root: { extras: {} } }));
  const held = await runOn(lite.root, []);
  expect(held.code).toBe(0);
  writeFileSync(
    spawn,
    JSON.stringify({ root: { extras: { more: "../common/huge.png" } } })
  );
  await expect(runOn(lite.root, ["--check"])).rejects.toThrow(
    "tileset-spawn.json names 1 files that the site does not serve"
  );
});

test("a site that is not built says so", () => {
  const { root, data } = fixture();
  expect(() => measure("nowhere", root)).toThrow(/build first/u);
  // nor one whose manifest names no tileset
  writeFileSync(nodePath.join(data, "manifest.json"), '{"files":{}}');
  expect(() => measure(SITE, root)).toThrow(/names no tileset\.json/u);
});
