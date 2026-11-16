/**
 * Plan 090's baseline, the part only a browser can produce (ignored unless
 * `DRESSING_LEDGER=1`, as the shot harness is unless `SHOTS=1`): for each
 * of the plan's tiles, on the desktop and the phone profile, what the fine
 * level's dressing costs the scene's thread builder by builder and what
 * its parts weigh in the tile cache (app/_components/dressing-figures.ts,
 * read through `handle.getDressingFigures()`), and the stream's own marks
 * (`dressing:build`, `dressing:compile`, the long tasks where the browser
 * reports them).
 *
 * The page is opened where the tile's middle is (`?at=lat,lng`) at the
 * lite render cost with the whole site streaming (`?scene=lite&block=1`):
 * the builders are the product's, only the frames are cheap. The figures
 * go to `.cache/ledger-dressing/browser.json` beside the machine and the
 * day they were read on; `bun run ledger` folds them into the ledger's
 * recorded section (`dressingRecorded.browser`), where nothing compares
 * them: on a software renderer a timing
 * says which builder is heavy, not how many milliseconds a phone pays.
 *
 *   DRESSING_LEDGER=1 bunx playwright test e2e/dressing-ledger.spec.ts
 *   DRESSING_QUERY=rails=table DRESSING_TAG=rail-table … (a spike's arm)
 */
import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import nodePath from "node:path";
import proj4 from "proj4";
import { SWIFTSHADER_WEBGPU } from "./swiftshader-webgpu";

test.use({ launchOptions: SWIFTSHADER_WEBGPU });
test.describe.configure({ mode: "serial", retries: 0 });

/** The plan's tiles (docs/plans/090, phase 0). */
const TILES = [
  { site: "dresden", tile: "33412_5656_2_sn", what: "spawn" },
  { site: "dresden", tile: "33416_5658_2_sn", what: "forest" },
  { site: "dresden", tile: "33410_5656_2_sn", what: "yards" },
  { site: "muenchen", tile: "32690_5334_2_by", what: "heaviest" },
] as const;

const PROFILES = {
  desktop: { viewport: { width: 400, height: 300 } },
  phone: {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  },
} as const;

const OUT = nodePath.join(process.cwd(), ".cache/ledger-dressing/browser.json");
const TAG = process.env.DRESSING_TAG ?? "baseline";
const EXTRA = process.env.DRESSING_QUERY
  ? `&${process.env.DRESSING_QUERY}`
  : "";
const ONLY = process.env.DRESSING_ONLY;

/** A tile's middle as `lat,lng` (its id names its zone and its south-west
 *  corner in km; a tile is 2 km a side). */
function middleOf(tile: string): string {
  const match = /^(?<zone>\d{2})(?<e>\d{3})_(?<n>\d{4})_/u.exec(tile);
  if (!match?.groups) {
    throw new Error(`not a tile id: ${tile}`);
  }
  const { zone, e, n } = match.groups;
  const [lng, lat] = proj4(
    `+proj=utm +zone=${zone} +ellps=GRS80 +units=m +no_defs`,
    "WGS84",
    [Number(e) * 1000 + 1000, Number(n) * 1000 + 1000]
  );
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

interface Read {
  figures: Record<
    string,
    { bytes: Record<string, number>; ms: Record<string, number> }
  >;
  timings: Record<string, { count: number; maxMs: number; totalMs: number }>;
}

function record(key: string, value: unknown): void {
  const file = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, "utf-8")) as Record<string, unknown>)
    : {};
  const all = cpus();
  file[TAG] = {
    ...(file[TAG] as Record<string, unknown> | undefined),
    machine: `${all[0]?.model.trim() ?? "unknown CPU"} ×${all.length}, ${process.platform}-${process.arch}, headless Chromium, WebGPU on SwiftShader`,
    read: new Date().toISOString().slice(0, 10),
    [key]: value,
  };
  mkdirSync(nodePath.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
}

const round = (ms: number) => Math.round(ms * 10) / 10;

for (const { site, tile, what } of TILES) {
  for (const [profile, context] of Object.entries(PROFILES)) {
    const name = `${what}:${profile}`;
    test(`dressing figures: ${site} ${tile} (${name})`, async ({ browser }) => {
      test.skip(ONLY !== undefined && ONLY !== name, "not asked for");
      test.setTimeout(900_000);
      const ctx = await browser.newContext(context);
      const page = await ctx.newPage();
      try {
        await page.goto(
          `/${site}?scene=lite&block=1&trace=1&at=${middleOf(tile)}${EXTRA}`
        );
        await page.waitForFunction(
          () => window.__poc?.ready === true,
          undefined,
          {
            timeout: 600_000,
          }
        );
        const key = `${tile}:fine`;
        // built (its parts weighed), then its ask sets, which idle time
        // builds once it hangs
        await page.waitForFunction(
          async (k) => {
            const all = await window.__poc?.handle?.getDressingFigures();
            const level = all?.levels[k];
            return (
              level !== undefined &&
              Object.keys(level.bytes).length > 0 &&
              level.ms.asks !== undefined
            );
          },
          key,
          { timeout: 600_000, polling: 2000 }
        );
        const read = await page.evaluate(async (): Promise<Read> => {
          const handle = window.__poc?.handle;
          if (!handle) {
            throw new Error("no handle");
          }
          const { levels, timings } = await handle.getDressingFigures();
          return { figures: levels, timings };
        });
        const level = read.figures[key];
        expect(level).toBeDefined();
        const ms = Object.fromEntries(
          Object.entries(level.ms)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([builder, v]) => [builder, round(v)])
        );
        const marks = Object.fromEntries(
          Object.entries(read.timings)
            .filter(([category]) =>
              /^(?:dressing:(?:build|compile|asks|queue-wait)|longtask)$/u.test(
                category
              )
            )
            .map(([category, s]) => [
              category,
              {
                count: s.count,
                maxMs: round(s.maxMs),
                totalMs: round(s.totalMs),
              },
            ])
        );
        record(`${site}/${tile}/${profile}`, {
          what,
          builderMs: ms,
          builderMsTotal: round(
            Object.values(level.ms).reduce((a, b) => a + b, 0)
          ),
          cacheBytes: level.bytes,
          cacheBytesTotal: Object.values(level.bytes).reduce(
            (a, b) => a + b,
            0
          ),
          // every level the page dressed, not this tile's alone
          marks,
        });
      } finally {
        await ctx.close();
      }
    });
  }
}
