import { afterEach, expect, test } from "bun:test";
import { Object3D } from "three/webgpu";
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { bakeFileProblems } from "@/lib/city/bake-file";
import type { DataLayerKey } from "@/lib/city/data-layers";
import { siteDataDir } from "@/lib/city/tile";
import { tramTimetableSource } from "@/lib/city/tram-timetable";
import { TRAMS_FILE } from "@/lib/city/tram-timetable-file";
import { SITES } from "@/sites";
import { createDataOverlays, isTramTimetable } from "./data-overlays";
import type { TramCarsStatus } from "./tram-cars";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers every request with `answer(url)`; counts the calls by URL. */
function stubFetch(answer: (url: string) => Response): Map<string, number> {
  const calls = new Map<string, number>();
  // reason: the stub takes the URL only; the helpers pass a string
  globalThis.fetch = (async (url: string) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    return answer(url);
  }) as unknown as typeof fetch;
  return calls;
}

/** Waits (a few event-loop turns at a time) until `ok()` holds. */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }
  expect(ok()).toBe(true);
}

const layers = (
  on: Partial<Record<DataLayerKey, boolean>>
): Record<DataLayerKey, boolean> => ({
  bikeLayer: false,
  trafficLayer: false,
  tramLayer: false,
  ...on,
});

const base = {
  bounds: [408_000, 5_654_000, 418_000, 5_660_000] as const,
  bridgeUrls: [],
  epsg: 25_833,
  ground: { offset: { cx: 0, cy: 0 }, heightAt: () => 0 },
  initialDate: new Date(2026, 9, 1, 7),
  parent: new Object3D(),
};

test("a timetable that failed to load says so and is tried again on the next switch-on", async () => {
  const calls = stubFetch(() => new Response(null, { status: 404 }));
  const statuses: (TramCarsStatus | null)[] = [];
  const overlays = createDataOverlays({
    ...base,
    compile: async () => {},
    onTramStatus: (s) => {
      statuses.push(s);
    },
    tramTimetableUrl: "/data/trams.json",
  });
  overlays.apply(layers({ tramLayer: true }));
  await until(() => statuses.some((s) => s?.failed));
  overlays.apply(layers({ tramLayer: false }));
  overlays.apply(layers({ tramLayer: true }));
  await until(() => calls.get("/data/trams.json") === 2);
  await until(() => statuses.filter((s) => s?.failed).length === 2);
  overlays.dispose();
});

test("trams whose compile failed leave the scene, and the next switch-on adds one set", async () => {
  stubFetch(() =>
    Response.json({ days: {}, patterns: [], profiles: [], routes: [] })
  );
  const parent = new Object3D();
  const trams = () => parent.children.filter((c) => c.name === "tram-cars");
  const statuses: (TramCarsStatus | null)[] = [];
  let compiles = 0;
  const overlays = createDataOverlays({
    ...base,
    parent,
    compile: async () => {
      compiles += 1;
      if (compiles === 1) {
        throw new Error("pipeline");
      }
    },
    onTramStatus: (s) => {
      statuses.push(s);
    },
    tramTimetableUrl: "/data/trams.json",
  });
  overlays.apply(layers({ tramLayer: true }));
  await until(() => statuses.some((s) => s?.failed));
  expect(trams()).toHaveLength(0);
  overlays.apply(layers({ tramLayer: false }));
  overlays.apply(layers({ tramLayer: true }));
  await until(() => overlays.parts().trams?.visible === true);
  expect(trams()).toHaveLength(1);
  overlays.dispose();
  expect(trams()).toHaveLength(0);
});

// The viewer's guard and the build's schema (ADR 0059) agree: every
// committed timetable passes both; what the guard refuses, the schema does.
const ROOT = nodePath.join(import.meta.dir, "..", "..");
const timetables = Object.values(SITES)
  .map((site) => nodePath.join(ROOT, tramTimetableSource(siteDataDir(site))))
  .filter((path) => existsSync(path));

test.each(timetables)("the guard accepts %s, as its schema does", (path) => {
  const json: unknown = JSON.parse(readFileSync(path, "utf-8"));
  expect(bakeFileProblems(TRAMS_FILE, json)).toEqual([]);
  expect(isTramTimetable(json)).toBe(true);
});

test("a malformed timetable is a failed load", () => {
  const whole = { days: {}, patterns: [], profiles: [], routes: [] };
  for (const broken of [
    null,
    { patterns: [] },
    { ...whole, days: [] },
    { ...whole, profiles: undefined },
    { ...whole, routes: "11" },
  ]) {
    expect(isTramTimetable(broken)).toBe(false);
    expect(bakeFileProblems(TRAMS_FILE, broken)).not.toEqual([]);
  }
  // a timetable from before the agencies and the CRS were written still runs
  expect(isTramTimetable(whole)).toBe(true);
});

test("a counter layer whose compile failed compiles again with the next counts", async () => {
  stubFetch(() =>
    Response.json({
      features: [
        {
          geometry: { coordinates: [412_610, 5_657_020], type: "Point" },
          properties: {
            messzeit: "01.10.2026 07:00:00",
            r1: "Richtung Nord",
            w1: 10,
          },
          type: "Feature",
        },
      ],
    })
  );
  let compiles = 0;
  const overlays = createDataOverlays({
    ...base,
    bikeFeed: "dresden",
    compile: async () => {
      compiles += 1;
      if (compiles === 1) {
        throw new Error("pipeline");
      }
    },
  });
  overlays.apply(layers({ bikeLayer: true }));
  await until(() => compiles === 1);
  // a turn for the rejection to land
  await new Promise((resolve) => {
    setTimeout(resolve, 1);
  });
  overlays.apply(layers({ bikeLayer: false }));
  overlays.apply(layers({ bikeLayer: true }));
  await until(() => compiles === 2);
  await until(() => overlays.parts().bikes?.visible === true);
  overlays.dispose();
});
