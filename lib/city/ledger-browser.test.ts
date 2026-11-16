import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  browserLedger,
  firstLoadFigures,
  jsGzip,
  PHONE_NOTE,
  phoneCache,
  servedName,
  timingRows,
} from "./ledger-browser";
import type { BrowserReading } from "./ledger-browser";

test("a script weighs its gzip -9 bytes, the same body the same figure", () => {
  const body = new TextEncoder().encode(
    Array.from({ length: 4000 }, (_, i) => `v${(i * 7919) % 1013};`).join("")
  );
  expect(jsGzip(body)).toBe(gzipSync(body, { level: 9 }).length);
  // level 9, not the wire rule's 6, and not the raw length
  expect(jsGzip(body)).not.toBe(gzipSync(body, { level: 6 }).length);
  expect(jsGzip(body)).toBeLessThan(body.length);
  expect(jsGzip(body)).toBe(jsGzip(new Uint8Array(body)));
});

test("the first load: every file, and those only a worker fetched", () => {
  expect(
    firstLoadFigures([
      { gzip: 100, worker: false },
      { gzip: 50, worker: true },
      { gzip: 25, worker: true },
    ])
  ).toMatchObject({
    files: 3,
    gzip: 175,
    workerOnly: { files: 2, gzip: 75 },
  });
});

test("a content's served name: its URI's last segment, no query", () => {
  expect(servedName("./a/terrain_t_l1.abc.glb.gz?v=1")).toBe(
    "terrain_t_l1.abc.glb.gz"
  );
  expect(servedName("city_t.def.glb.gz")).toBe("city_t.def.glb.gz");
});

test("a phone's cache: the loaded contents only, by logical name", () => {
  const logical = new Map([
    ["terrain_t_l1.abc.glb.gz", "terrain_t_l1.glb.gz"],
    ["city_t.def.glb.gz", "city_t.glb.gz"],
  ]);
  expect(
    phoneCache(
      [
        { uri: "./terrain_t_l1.abc.glb.gz", bytes: 300, loaded: true },
        { uri: "city_t.def.glb.gz", bytes: 9000, loaded: true },
        // requested, not yet loaded: left out, whatever it lists
        { uri: "terrain_t_l0.0f0.glb.gz", bytes: 7, loaded: false },
        { uri: "odd.bin", bytes: 5, loaded: true },
        // the same content twice is summed, not the last one kept
        { uri: "odd.bin", bytes: 6, loaded: true },
      ],
      (served) => logical.get(served)
    )
  ).toEqual({
    note: PHONE_NOTE,
    bytes: 9311,
    contents: {
      "city_t.glb.gz": 9000,
      "odd.bin": 11,
      "terrain_t_l1.glb.gz": 300,
    },
  });
});

test("the timings keep the boot, a tile's dressing and compile, the long tasks", () => {
  expect(
    Object.keys(
      timingRows({
        "boot:tileset": { count: 1, totalMs: 12.345, maxMs: 12.345 },
        "tile:bvh": { count: 3, totalMs: 9, maxMs: 4 },
        "tile:compile": { count: 2, totalMs: 40, maxMs: 30 },
        "dressing:build": { count: 2, totalMs: 40, maxMs: 30 },
        "dressing:queue-wait": { count: 2, totalMs: 40, maxMs: 30 },
        longtask: { count: 0, totalMs: 0, maxMs: 0 },
      })
    )
  ).toEqual(["boot:tileset", "dressing:build", "longtask", "tile:compile"]);
  expect(
    timingRows({ "boot:frame": { count: 1, totalMs: 1.26, maxMs: 1.24 } })
  ).toEqual({ "boot:frame": { count: 1, totalMs: 1.3, maxMs: 1.2 } });
});

const READING: BrowserReading = {
  adapter: "google / swiftshader",
  browser: "chromium 153",
  firstLoad: [
    { url: "/_next/static/chunks/b.js", body: "js-1.js", worker: true },
    { url: "/_next/static/chunks/a.js", body: "js-0.js", worker: false },
  ],
  workers: ["scene", "niches", "ground"],
  elsewhere: ["/_next/static/chunks/bvh.js"],
  phone: {
    tier: "mobile",
    held: { geometries: 2, textures: 1 },
    tiles: [
      { uri: "terrain_t_l1.abc.glb.gz", bytes: 300, loaded: true },
      { uri: "city_t.def.glb.gz", bytes: 1000, loaded: true },
    ],
  },
  timings: {
    desktop: { "boot:loaded": { count: 1, totalMs: 900, maxMs: 900 } },
    phone: { "boot:loaded": { count: 1, totalMs: 1200, maxMs: 1200 } },
  },
};

test("the browser's reading: figures gated, the rest recorded", () => {
  const gzip = new Map([
    ["/_next/static/chunks/a.js", 2000],
    ["/_next/static/chunks/b.js", 1000],
  ]);
  const { browser, timings } = browserLedger(
    READING,
    (url) => gzip.get(url) ?? 0,
    () => {},
    "here",
    "2027-01-01"
  );
  expect(browser.readWith).toBe("chromium 153, google / swiftshader");
  expect(browser.firstLoad).toMatchObject({
    files: 2,
    gzip: 3000,
    workerOnly: { files: 1, gzip: 1000 },
  });
  expect(browser.phoneLiteSpawnCache.bytes).toBe(1300);
  expect(browser).not.toHaveProperty("held");
  expect(timings).toMatchObject({
    machine: "here",
    read: "2027-01-01",
    phoneHeld: { geometries: 2, textures: 1 },
    elsewhere: ["/_next/static/chunks/bvh.js"],
  });
  expect(timings.firstLoad.map((f) => f.url)).toEqual([
    "/_next/static/chunks/a.js",
    "/_next/static/chunks/b.js",
  ]);
});
