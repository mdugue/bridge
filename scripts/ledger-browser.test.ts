import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { COMPILE_WAIT_MS } from "../app/_components/late-parts";
import { CACHE_SETTLE_GAP_MS } from "../lib/city/ledger-browser";
import type { BrowserReading } from "../lib/city/ledger-browser";
import {
  checkRun,
  inlinedEnvSet,
  sectionsOf,
  staleServer,
  timingReport,
} from "./ledger-browser";

/** A script body whose gzip at level 9 differs from its raw length and
 *  from level 6. */
const BODY = new TextEncoder().encode(
  Array.from({ length: 4000 }, (_, i) => `v${(i * 7919) % 1013};`).join("")
);

const READING: BrowserReading = {
  adapter: "google / swiftshader",
  browser: "chromium 153",
  firstLoad: [
    { url: "/_next/static/chunks/a.js", body: "js-0.js", worker: false },
    { url: "/_next/static/chunks/b.js", body: "js-1.js", worker: true },
  ],
  workers: ["ground", "niches", "scene"],
  elsewhere: [],
  phone: {
    tier: "mobile",
    held: {},
    tiles: [{ uri: "./terrain_t_l1.abc.glb.gz", bytes: 300, loaded: true }],
  },
  timings: {
    desktop: { "boot:loaded": { count: 1, totalMs: 900, maxMs: 900 } },
    phone: { "boot:spawn-wait": { count: 1, totalMs: 1200, maxMs: 1200 } },
  },
};

const bodies: Record<string, Uint8Array> = {
  "js-0.js": BODY,
  "js-1.js": BODY.subarray(0, 2000),
};

test("a script weighs its body's gzip -9, by the manifest's logical names", () => {
  const { browser, timings } = sectionsOf(
    { reading: READING, body: (file) => bodies[file] ?? new Uint8Array() },
    // logical → served, as the manifest maps them
    { "terrain_t_l1.glb.gz": "terrain_t_l1.abc.glb.gz" },
    "here",
    "2027-01-01"
  );
  const a = gzipSync(BODY, { level: 9 }).length;
  const b = gzipSync(BODY.subarray(0, 2000), { level: 9 }).length;
  expect(a).not.toBe(BODY.length);
  expect(a).not.toBe(gzipSync(BODY, { level: 6 }).length);
  expect(browser.firstLoad.gzip).toBe(a + b);
  expect(browser.firstLoad.workerOnly.gzip).toBe(b);
  expect(timings.firstLoad.map((f) => f.gzip)).toEqual([a, b]);
  expect(browser.phoneLiteSpawnCache.contents).toEqual({
    "terrain_t_l1.glb.gz": 300,
  });
});

test("a script whose body was not weighed fails the read", () => {
  expect(() =>
    sectionsOf(
      {
        reading: {
          ...READING,
          firstLoad: [
            {
              url: "/_next/static/chunks/c.js",
              body: "js-9.js",
              worker: false,
            },
          ],
        },
        body: () => {
          throw new Error("no such body");
        },
      },
      {},
      "here",
      "2027-01-01"
    )
  ).toThrow("no such body");
});

test("the spec's run: a failure or a missing reading fails the read", () => {
  expect(() => checkRun(1, true)).toThrow("exit 1");
  expect(() => checkRun(null, true)).toThrow("read failed");
  expect(() => checkRun(0, false)).toThrow("read failed");
  expect(() => checkRun(0, true)).not.toThrow();
});

test("a build environment that inlines what CI does not set is named", () => {
  expect(inlinedEnvSet({ PATH: "/bin", VERCEL_ENV: " " })).toEqual([]);
  expect(
    inlinedEnvSet({
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
      VERCEL_GIT_COMMIT_SHA: "abc",
    })
  ).toEqual(["NEXT_PUBLIC_SENTRY_DSN", "VERCEL_GIT_COMMIT_SHA"]);
});

test("a running server must serve this tree's current build", () => {
  expect(staleServer('<html>"b":"B1"</html>', "B1", 20, 10)).toBeNull();
  expect(staleServer('<html>"b":"B0"</html>', "B1", 20, 10)).toContain(
    "does not serve"
  );
  expect(staleServer('<html>"b":"B1"</html>', "B1", 10, 20)).toContain(
    "newer than"
  );
});

test("the timings print a line for each side and category", () => {
  const { timings } = sectionsOf(
    { reading: READING, body: (file) => bodies[file] ?? new Uint8Array() },
    {},
    "this machine",
    "2027-01-01"
  );
  expect(timingReport(timings)).toBe(
    "recorded, not compared: desktop boot:loaded: 1× 900 ms (max 900)\n" +
      "recorded, not compared: phone boot:spawn-wait: 1× 1200 ms (max 1200)\n" +
      "recorded on: this machine\n"
  );
});

test("the phone's two reads are further apart than a late part's compile wait", () => {
  expect(CACHE_SETTLE_GAP_MS).toBeGreaterThan(COMPILE_WAIT_MS);
});
