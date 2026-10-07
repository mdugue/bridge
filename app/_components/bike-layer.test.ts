import { expect, test } from "bun:test";
import type { BikeCounter } from "@/lib/city/bike-counts";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { createBikeFeed, createBikeLayer } from "./bike-layer";
import type { Instances } from "./instancing";

const counter = (
  id: string,
  x: number,
  counts: number[],
  measuredAt = new Date(2026, 9, 1, 7)
): BikeCounter => ({
  angleDeg: 0,
  directions: counts.map((count, i) => ({ toward: `R${i}`, count })),
  id,
  measuredAt,
  name: id,
  where: "",
  x,
  y: 0,
});

const columnsOf = (layer: ReturnType<typeof createBikeLayer>) =>
  layer.group.children[0] as Instances;

test("a column per direction, standing on the ground, as tall as its count", () => {
  let loaded = 100;
  const ctx: GroundContext = {
    offset: { cx: 0, cy: 0 },
    heightAt: (x) => (x < loaded ? 110 : null),
  };
  const layer = createBikeLayer(ctx);
  layer.set(
    [
      counter("a", 10, [309, 482]),
      counter("b", 50, [123]),
      counter("c", 150, [5, 5]),
    ],
    new Date(2026, 9, 1, 7, 30)
  );
  const columns = columnsOf(layer);
  // c stands over ground not loaded yet: it waits
  expect(columns.drawCount).toBe(3);
  expect(columns.castShadow).toBe(false);
  loaded = 200;
  expect(layer.reground()).toBe(true);
  expect(columns.drawCount).toBe(5);
  expect(layer.reground()).toBe(false);
  layer.dispose();
});

test("an old count stands grey", () => {
  const ctx: GroundContext = { offset: { cx: 0, cy: 0 }, heightAt: () => 0 };
  const layer = createBikeLayer(ctx);
  layer.set([counter("a", 0, [10, 10])], new Date(2026, 9, 1, 7, 30));
  const fresh = Array.from(columnsOf(layer).instanceTints?.array ?? []).slice(
    0,
    3
  );
  layer.set([counter("a", 0, [10, 10])], new Date(2026, 9, 2, 7, 30));
  const stale = Array.from(columnsOf(layer).instanceTints?.array ?? []).slice(
    0,
    3
  );
  expect(stale).not.toEqual(fresh);
  // grey: the three channels close together
  expect(Math.max(...stale) - Math.min(...stale)).toBeLessThan(0.1);
  layer.dispose();
});

/** Answers every request with `body` as JSON; counts the calls. */
function stubFetch(body: unknown): {
  calls: () => number;
  restore: () => void;
} {
  const real = globalThis.fetch;
  let calls = 0;
  // reason: the stub takes the URL only; the helpers pass a string
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify(body)));
  }) as unknown as typeof fetch;
  return {
    calls: () => calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

test("an answer the feed cannot parse is no crash: the last counts stay", async () => {
  const stub = stubFetch({ features: [] });
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  const heard: BikeCounter[][] = [];
  const feed = createBikeFeed({
    bounds: [0, 0, 1, 1],
    epsg: 25_833,
    feed: {
      url: () => "/bikes",
      parse: () => {
        throw new TypeError("Cannot read properties of null");
      },
    },
    onCounts: (c) => heard.push(c),
  });
  try {
    feed.start();
    await settle();
    expect(stub.calls()).toBe(1);
    expect(heard).toEqual([]);
    expect(rejections).toEqual([]);
  } finally {
    feed.stop();
    process.off("unhandledRejection", onRejection);
    stub.restore();
  }
});

test("the counters are read only while the page is in view", async () => {
  const stub = stubFetch({ features: [] });
  const listeners = new Set<() => void>();
  const page = {
    hidden: true,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  const g = globalThis as { document?: unknown };
  const real = g.document;
  g.document = page;
  const show = (hidden: boolean) => {
    page.hidden = hidden;
    for (const fn of listeners) {
      fn();
    }
  };
  let heard = 0;
  const feed = createBikeFeed({
    bounds: [0, 0, 1, 1],
    epsg: 25_833,
    feed: { url: () => "/bikes", parse: () => [] },
    onCounts: () => heard++,
  });
  try {
    feed.start();
    await settle();
    // hidden: no request
    expect(stub.calls()).toBe(0);
    // back in view with no counts yet (older than a poll): one read
    show(false);
    await settle();
    expect(stub.calls()).toBe(1);
    expect(heard).toBe(1);
    // hidden and shown again within the poll: the counts are fresh
    show(true);
    show(false);
    await settle();
    expect(stub.calls()).toBe(1);
    feed.stop();
    expect(listeners.size).toBe(0);
  } finally {
    feed.stop();
    g.document = real;
    stub.restore();
  }
});
