/** The ledger (scripts/ledger.ts, lib/city/ledger.ts) on a fixture
 *  repository: one published site of two tiles and a few sources. */
import { afterAll, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { gzipSync } from "node:zlib";
import { browserFigures } from "../lib/city/ledger";
import { buildTileset } from "../lib/city/tileset";
import type { BakedTile, TerrainFiles } from "../lib/city/tileset";
import { codeProduct, LEDGER_PATH, measure, run } from "./ledger";

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
const WATCHED = { spawn: "a" };

/** `bytes` bytes that gzip to about as many. */
const noise = (bytes: number, seed: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  let state = seed + 1;
  for (let i = 0; i < bytes; i += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) % 4_294_967_296;
    out[i] = 33 + (Math.abs(Math.floor(state / 65_536)) % 90);
  }
  return out;
};

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const put = (root: string, path: string, body: Uint8Array | string) => {
  mkdirSync(nodePath.dirname(nodePath.join(root, path)), { recursive: true });
  writeFileSync(nodePath.join(root, path), body);
};

const git = (root: string, ...args: string[]) => {
  const env = { ...process.env, GIT_DIR: undefined, GIT_INDEX_FILE: undefined };
  const identity = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
  expect(
    Bun.spawnSync(["git", ...identity, ...args], { cwd: root, env }).exitCode
  ).toBe(0);
};

/** A repository in small: the published site, and sources git tracks. */
function fixture(): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), "ledger-test-"));
  roots.push(root);
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
  const files: Record<string, Uint8Array | string> = {
    "tileset.json": JSON.stringify(tileset),
    "trams.json": noise(300, 1),
    "stadtwissen.json": " ".repeat(5000),
  };
  for (const [i, t] of TILES.entries()) {
    const big = i + 1;
    Object.assign(files, {
      [`city_${t}.glb.gz`]: noise(1000 * big, 14),
      [`city_${t}_far.glb.gz`]: noise(300 * big, 15),
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
    // the manifest finds the tileset under its hashed name
    const served =
      logical === "tileset.json" ? "tileset.0a1b2c3d.json" : logical;
    manifest.files[logical] = served;
    put(root, `public/data/${SITE}/${served}`, bytes);
  }
  put(root, `public/data/${SITE}/manifest.json`, JSON.stringify(manifest));
  put(root, `public/data/${SITE}/site-stats.json`, "{}");
  put(
    root,
    "app/page.tsx",
    "/** A page.\n * Two lines of it. */\nexport const a = 1;\n\n// said\nexport const b = (\n  <p>\n    {/* not this */}\n  </p>\n);\n"
  );
  put(root, "lib/city/thing.ts", "export const c = 1;\n");
  put(root, "lib/city/thing.test.ts", "export const t = 1;\n");
  put(root, "lib/city/__fixtures__/f.ts", "export const f = 1;\n");
  put(root, "lib/city/ledger.ts", "export const tool = 1;\n");
  put(root, "scripts/eval/probe.ts", "export const p = 1;\n");
  put(root, "pipeline/bake/trees.py", "# a bake\n\nx = 1\ny = 2\n");
  put(root, "pipeline/tests/test_trees.py", "z = 3\n");
  put(root, "qa/.keep", "");
  put(root, ".gitignore", "public/\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

/** Runs the script on a fixture, collecting its report. */
const runOn = (root: string, argv: string[]) => {
  let report = "";
  const code = run(argv, {
    root,
    site: SITE,
    watched: WATCHED,
    out: (text) => {
      report += text;
    },
  });
  return { code, report };
};

const data = (root: string, file: string) =>
  nodePath.join(root, "public/data", SITE, file);
const gz = (root: string, file: string) =>
  gzipSync(readFileSync(data(root, file)), { level: 6 }).length;
const resize = (root: string, file: string, bytes: number) =>
  writeFileSync(data(root, file), noise(bytes, 99));

test("the figures of a fixture site, each from the files it names", () => {
  const root = fixture();
  const ledger = measure(SITE, root, WATCHED);
  expect(ledger.tiles).toBe(2);
  // the spawn tile, a, from afar: the far buildings, the facade reading
  // (text: gzipped), the coarse terrain, its class raster, sky view, crowns
  expect(ledger.bytes.far.spawn).toEqual({
    tile: "a",
    bytes:
      300 +
      gz(root, "facades_a.json") +
      100 +
      500 +
      200 +
      gz(root, "crowns_a.json"),
    files: 6,
  });
  expect(ledger.bytes.far.phone).toBeUndefined();
  // its fine level beyond the reach reads the paving's twin; approached,
  // the full paving on top; a phone, the class raster's twin
  const fine = 400 + 4000 + 200 + gz(root, "lamps_a.geojson");
  expect(ledger.bytes.fine.spawn).toEqual({
    tile: "a",
    bytes: fine + 700,
    files: 5,
  });
  expect(ledger.bytes.approached.spawn.bytes).toBe(fine + 700 + 3000);
  expect(ledger.bytes.fine.phone?.spawn.bytes).toBe(fine - 4000 + 1000 + 700);
  expect(ledger.bytes.near.largest).toEqual({
    tile: "b",
    bytes: 2000,
    files: 1,
  });
  expect(ledger.bytes.all.spawn.files).toBe(14);
  // every file of the directory in one class; the server's on disk
  expect(ledger.published.files).toBe(33);
  expect(ledger.published.tiles).toEqual(ledger.bytes.all.site);
  expect(ledger.published.boot).toEqual({
    bytes: gz(root, "manifest.json") + gz(root, "tileset.0a1b2c3d.json"),
    files: 2,
  });
  expect(ledger.published.server).toEqual({ bytes: 5002, files: 2 });
  expect(ledger.published.kinds.trams).toEqual({
    class: "site",
    bytes: gz(root, "trams.json"),
    files: 1,
  });
  // the watched tile's dressing, a request a kind
  expect(ledger.dressing).toEqual({
    spawn: {
      tile: "a",
      fine: {
        bytes: gz(root, "lamps_a.geojson"),
        files: 1,
        kinds: { lamps: gz(root, "lamps_a.geojson") },
      },
      coarse: {
        bytes: gz(root, "crowns_a.json"),
        files: 1,
        kinds: { dressingCoarse: gz(root, "crowns_a.json") },
      },
    },
  });
});

test("code.product: code lines of the product, by area; --against a ref", () => {
  const root = fixture();
  // no comment, no blank line, no test, fixture, probe or measuring tool
  const was = {
    app: 5,
    lib: 1,
    components: 0,
    scripts: 0,
    "pipeline/bake": 2,
    total: 8,
  };
  expect(codeProduct(root)).toEqual(was);
  expect(measure(SITE, root, WATCHED).code.product).toEqual(was);
  put(
    root,
    "lib/city/thing.ts",
    "// more\nexport const c = 1;\nc.toFixed();\n"
  );
  put(root, "scripts/new.ts", "export const untracked = 1;\n");
  expect(codeProduct(root)).toEqual({ ...was, lib: 2, total: 9 });
  expect(codeProduct(root, "HEAD")).toEqual(was);
  expect(runOn(root, ["--against", "HEAD"]).report).toContain(
    "code.product.lib: 1 (HEAD) → 2 (+1)\ncode.product.components: 0 (HEAD) → 0 (+0)\n"
  );
});

test("a write, then a check that holds; a second write is the same file", () => {
  const root = fixture();
  expect(runOn(root, ["--check"]).code).toBe(1);
  expect(runOn(root, [])).toEqual({ code: 0, report: "qa/ledger.json\n" });
  const written = readFileSync(nodePath.join(root, LEDGER_PATH), "utf-8");
  expect(JSON.parse(written)).toEqual({ ...measure(SITE, root, WATCHED) });
  expect(runOn(root, ["--check"])).toEqual({
    code: 0,
    report:
      "the browser figures were not compared (no --browser)\nqa/ledger.json holds\n",
  });
  runOn(root, []);
  expect(readFileSync(nodePath.join(root, LEDGER_PATH), "utf-8")).toBe(written);
  // written as the formatter leaves it: the lint's check finds nothing
  const repo = nodePath.join(import.meta.dir, "..");
  const formatted = Bun.spawnSync(
    [
      nodePath.join(repo, "node_modules/.bin/oxfmt"),
      "--check",
      nodePath.join(root, LEDGER_PATH),
    ],
    { cwd: repo }
  );
  expect(formatted.exitCode).toBe(0);
}, 60_000);

test("a file that grew fails the check, by its figures' names", () => {
  const root = fixture();
  runOn(root, []);
  const was = gz(root, "lamps_a.geojson");
  resize(root, "lamps_a.geojson", 900);
  const now = gz(root, "lamps_a.geojson");
  const { code, report } = runOn(root, ["--check"]);
  expect(code).toBe(1);
  expect(report).toContain(
    `differs: dressing.spawn.fine.kinds.lamps: ${was} → ${now}\n`
  );
  expect(report).toContain("differs: bytes.fine.spawn.bytes: ");
  expect(report).toContain("differs: published.tiles.bytes: ");
  expect(report).toContain("run bun scripts/ledger.ts and commit");
  // a file that shrank fails too: a saving is committed
  runOn(root, []);
  resize(root, "surface_a.png", 2000);
  expect(runOn(root, ["--check"]).report).toContain(
    "differs: bytes.approached.spawn.bytes: "
  );
  // a site-wide file and the server's are gated too
  runOn(root, []);
  resize(root, "trams.json", 400);
  resize(root, "stadtwissen.json", 6000);
  const site = runOn(root, ["--check"]).report;
  expect(site).toContain("differs: published.kinds.trams.bytes: ");
  expect(site).toContain("differs: published.server.bytes: 5002 → 6002\n");
});

test("--code needs no build: a rise fails, a fall passes, a write records it", () => {
  const root = fixture();
  runOn(root, []);
  rmSync(nodePath.join(root, "public"), { recursive: true });
  put(root, "lib/city/thing.ts", "// why\nexport const c = 1;\n");
  expect(runOn(root, ["--code", "--check"]).code).toBe(0);
  put(root, "lib/city/thing.ts", "export const c = 1;\nc.toFixed();\n");
  const rose = runOn(root, ["--code", "--check"]);
  expect(rose.code).toBe(1);
  expect(rose.report).toContain("code.product.total rose: 8 → 9");
  expect(runOn(root, ["--code"]).report).toBe(
    "qa/ledger.json: code.product.total 9\n"
  );
  expect(runOn(root, ["--code", "--check"]).code).toBe(0);
  rmSync(nodePath.join(root, "pipeline/bake/trees.py"));
  expect(runOn(root, ["--code", "--check"])).toEqual({
    code: 0,
    report: "code.product.total: 7 (committed 9)\n",
  });
});

test("a file in no class, and an extension the wire rule does not know, are errors", () => {
  const root = fixture();
  put(root, `public/data/${SITE}/extra.json`, "{}");
  expect(() => runOn(root, [])).toThrow(/in no class.*extra\.json/u);
  rmSync(data(root, "extra.json"));
  // a raw .glb counted as if a host compressed it would be a guess
  const manifest = JSON.parse(
    readFileSync(data(root, "manifest.json"), "utf-8")
  ) as { files: Record<string, string> };
  manifest.files["trams.json"] = "trams.bin";
  writeFileSync(data(root, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(data(root, "trams.bin"), noise(10, 1));
  rmSync(data(root, "trams.json"));
  expect(() => runOn(root, [])).toThrow(/trams\.bin has an extension/u);
});

test("an argument the script does not know is refused, nothing written", () => {
  const root = fixture();
  const { code, report } = runOn(root, ["--chekc"]);
  expect(code).toBe(2);
  expect(report).toContain("unknown argument --chekc");
  expect(runOn(root, ["--check"]).report).toContain("(none)");
});

test("the browser's figures: the scripts weighed, the phone's loaded contents", () => {
  const figures = browserFigures(
    {
      browser: "chromium 1",
      adapter: "google / swiftshader",
      firstLoad: [
        { url: "/_next/static/a.js", body: "aaaa", worker: false },
        { url: "/_next/static/b.js", body: "bb", worker: true },
      ],
      phone: [
        { uri: "/data/test/city.0a1b.glb.gz?v=2", bytes: 70, loaded: true },
        { uri: "/data/test/terrain.glb.gz", bytes: 30, loaded: true },
        { uri: "/data/test/far.glb.gz", bytes: 0, loaded: false },
      ],
    },
    (body) => body.length,
    (served) => (served === "city.0a1b.glb.gz" ? "city.glb.gz" : undefined)
  );
  expect(figures).toEqual({
    readWith: "chromium 1, google / swiftshader",
    firstLoad: { files: 2, gzip: 6, workerOnly: { files: 1, gzip: 2 } },
    phoneLiteSpawnCache: {
      bytes: 100,
      contents: { "city.glb.gz": 70, "terrain.glb.gz": 30 },
    },
  });
});
