import { afterEach, expect, test } from "bun:test";
import { Object3D } from "three/webgpu";
import type { DataLayerKey } from "@/lib/city/data-layers";
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
  globalThis.fetch = ((url: string) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    return Promise.resolve(answer(url));
  }) as unknown as typeof fetch;
  return calls;
}

/** Waits (a few event-loop turns at a time) until `ok()` holds. */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) {
    await new Promise((r) => setTimeout(r, 1));
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
    compile: () => Promise.resolve(),
    onTramStatus: (s) => statuses.push(s),
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

test("a malformed timetable is a failed load", () => {
  expect(isTramTimetable(null)).toBe(false);
  expect(isTramTimetable({ patterns: [] })).toBe(false);
  expect(
    isTramTimetable({ days: {}, patterns: [], profiles: [], routes: [] })
  ).toBe(true);
});

test("a counter layer whose compile failed compiles again with the next counts", async () => {
  stubFetch(
    () =>
      new Response(
        JSON.stringify({
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
      )
  );
  let compiles = 0;
  const overlays = createDataOverlays({
    ...base,
    bikeFeed: "dresden",
    compile: () => {
      compiles++;
      return compiles === 1
        ? Promise.reject(new Error("pipeline"))
        : Promise.resolve();
    },
  });
  overlays.apply(layers({ bikeLayer: true }));
  await until(() => compiles === 1);
  // a turn for the rejection to land
  await new Promise((r) => setTimeout(r, 1));
  overlays.apply(layers({ bikeLayer: false }));
  overlays.apply(layers({ bikeLayer: true }));
  await until(() => compiles === 2);
  await until(() => overlays.parts().bikes?.visible === true);
  overlays.dispose();
});
