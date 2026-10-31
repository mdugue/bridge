import { expect, test } from "bun:test";
import {
  allowedMs,
  artifactHash,
  sealed,
  sharedCache,
  unsealed,
} from "./shared-cache";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (b: Uint8Array | null | undefined) =>
  b ? new TextDecoder().decode(b) : null;
const ENV = { VERCEL_ARTIFACTS_OWNER: "team_x", VERCEL_ARTIFACTS_TOKEN: "t" };
const RUNTIME = "bun 1.3.14 linux-x64";

/** A Remote Cache in memory, answering as the artifacts API does. */
function fakeApi(opts: { putStatus?: () => number; down?: boolean } = {}) {
  const store = new Map<string, Uint8Array<ArrayBuffer>>();
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      auth: new Headers(init?.headers).get("Authorization"),
      method,
      url,
    });
    if (opts.down) {
      throw new Error("offline");
    }
    const hash = new URL(url).pathname.split("/").pop() ?? "";
    if (method === "PUT") {
      const status = opts.putStatus?.() ?? 202;
      if (status < 300) {
        store.set(hash, new Uint8Array(init?.body as Uint8Array<ArrayBuffer>));
      }
      return new Response(status < 300 ? "{}" : "refused", { status });
    }
    const found = store.get(hash);
    return found ? new Response(found) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher, store };
}

test("off outside a Vercel build or when switched off", () => {
  expect(sharedCache({}, () => {}, RUNTIME).cache).toBeNull();
  // a Turborepo token elsewhere is not Vercel's build: its runtime differs
  expect(sharedCache({ TURBO_TOKEN: "t" }, () => {}, RUNTIME).cache).toBeNull();
  expect(
    sharedCache({ ...ENV, BAKE_SHARED_CACHE: "0" }, () => {}, RUNTIME).cache
  ).toBeNull();
});

test("an entry stored by one branch is fetched by another", async () => {
  const api = fakeApi();
  const first = sharedCache(ENV, () => {}, RUNTIME, api.fetcher).cache;
  expect(await first?.get("city_a.glb.gz", "k1")).toBeNull();
  first?.put("city_a.glb.gz", "k1", () => bytes("baked"));
  await first?.flush();
  expect(first?.stats().stored).toBe(1);

  const second = sharedCache(ENV, () => {}, RUNTIME, api.fetcher).cache;
  expect(text(await second?.get("city_a.glb.gz", "k1"))).toBe("baked");
  // another key, another name: their own entries
  expect(await second?.get("city_a.glb.gz", "k2")).toBeNull();
  expect(await second?.get("city_b.glb.gz", "k1")).toBeNull();
  expect(second?.stats()).toEqual({ bytes: 5, hits: 1, misses: 2, stored: 0 });
  expect(api.calls.every((c) => c.auth === "Bearer t")).toBe(true);
  expect(api.calls.every((c) => c.url.endsWith("?teamId=team_x"))).toBe(true);
});

test("another runtime bakes under addresses of its own", async () => {
  const api = fakeApi();
  const old = sharedCache(ENV, () => {}, RUNTIME, api.fetcher).cache;
  old?.put("a", "k", () => bytes("x"));
  await old?.flush();
  const bumped = sharedCache(
    ENV,
    () => {},
    "bun 1.4.4 linux-x64",
    api.fetcher
  ).cache;
  expect(await bumped?.get("a", "k")).toBeNull();
});

test("bytes that do not match their digest are a miss", async () => {
  const api = fakeApi();
  api.store.set(
    artifactHash("a", "k", RUNTIME, "production"),
    new Uint8Array([...sealed(bytes("good")).subarray(0, 32), ...bytes("evil")])
  );
  const lines: string[] = [];
  const cache = sharedCache(
    ENV,
    (l) => lines.push(l),
    RUNTIME,
    api.fetcher
  ).cache;
  expect(await cache?.get("a", "k")).toBeNull();
  expect(lines[0]).toContain("digest");
  expect(text(unsealed(sealed(bytes("good"))))).toBe("good");
  expect(unsealed(bytes("short"))).toBeNull();
});

test("an entry refused for its size is skipped alone", async () => {
  let n = 0;
  const api = fakeApi({ putStatus: () => (n++ === 0 ? 413 : 202) });
  const cache = sharedCache(ENV, () => {}, RUNTIME, api.fetcher).cache;
  cache?.put("big", "k", () => bytes("x".repeat(100)));
  cache?.put("small", "k", () => bytes("y"));
  await cache?.flush();
  expect(cache?.stats().stored).toBe(1);
});

test("failures in a row end the run's use of the cache, never throwing", async () => {
  const api = fakeApi({ down: true });
  const lines: string[] = [];
  const cache = sharedCache(
    ENV,
    (l) => lines.push(l),
    RUNTIME,
    api.fetcher
  ).cache;
  for (const name of ["a", "b", "c", "d", "e"]) {
    expect(await cache?.get(name, "k")).toBeNull();
  }
  cache?.put("f", "k", () => bytes("x"));
  await cache?.flush();
  // a preview asks both scopes: two requests, two more, then none
  expect(api.calls).toHaveLength(4);
  expect(lines.at(-1)).toContain("not asked again");
});

test("uploads cut off end the uploads, not the fetches", async () => {
  const api = fakeApi();
  let puts = 0;
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts++;
      throw new DOMException("The operation timed out.", "TimeoutError");
    }
    return api.fetcher(input, init);
  }) as typeof fetch;
  const lines: string[] = [];
  const cache = sharedCache(ENV, (l) => lines.push(l), RUNTIME, fetcher).cache;
  for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    cache?.put(name, "k", () => bytes(name));
  }
  await cache?.flush();
  // two cut off, at most the four lanes' first uploads in flight, then none
  expect(puts).toBeGreaterThanOrEqual(2);
  expect(puts).toBeLessThanOrEqual(4);
  expect(lines.some((l) => l.includes("no more uploads"))).toBe(true);
  expect(await cache?.get("z", "k")).toBeNull();
  // both scopes asked, the fetches go on
  expect(api.calls.filter((c) => c.method === "GET")).toHaveLength(2);
});

test("production reads only what production stored", async () => {
  const api = fakeApi();
  const PROD = { ...ENV, VERCEL_ENV: "production" };
  const preview = sharedCache(ENV, () => {}, RUNTIME, api.fetcher).cache;
  preview?.put("a", "k", () => bytes("preview"));
  await preview?.flush();
  const prod = sharedCache(PROD, () => {}, RUNTIME, api.fetcher).cache;
  expect(await prod?.get("a", "k")).toBeNull();
  prod?.put("b", "k", () => bytes("main"));
  await prod?.flush();
  // a preview takes production's entries and its own
  const next = sharedCache(ENV, () => {}, RUNTIME, api.fetcher).cache;
  expect(text(await next?.get("b", "k"))).toBe("main");
  expect(text(await next?.get("a", "k"))).toBe("preview");
});

test("a request gets its answer's time plus its bytes' at the slowest rate", () => {
  expect(allowedMs(0)).toBe(30_000);
  expect(allowedMs(60 * 1024 ** 2)).toBe(90_000);
});

test("the address is hex and differs by name, key, runtime and scope", () => {
  const a = artifactHash("a", "k", RUNTIME, "preview");
  expect(a).toMatch(/^[0-9a-f]{64}$/u);
  expect(artifactHash("b", "k", RUNTIME, "preview")).not.toBe(a);
  expect(artifactHash("a", "j", RUNTIME, "preview")).not.toBe(a);
  expect(artifactHash("a", "k", "bun 1.4.4 linux-x64", "preview")).not.toBe(a);
  expect(artifactHash("a", "k", RUNTIME, "production")).not.toBe(a);
});

test("uploads wait for the run's end and skip an entry gone by then", async () => {
  const api = fakeApi();
  const lines: string[] = [];
  const cache = sharedCache(
    ENV,
    (l) => lines.push(l),
    RUNTIME,
    api.fetcher
  ).cache;
  cache?.put("unreadable", "k", () => {
    throw new Error("EIO");
  });
  cache?.put("gone", "k", () => null);
  // more entries than lanes: the lane that met the throw goes on
  for (const name of ["a", "b", "c", "d", "e"]) {
    cache?.put(name, "k", () => bytes(name));
  }
  expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  await cache?.flush();
  expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(5);
  expect(cache?.stats().stored).toBe(5);
  expect(lines).toEqual(["shared cache: unreadable not read back (EIO)"]);
});

test("a stand-in API is ignored on Vercel", async () => {
  const api = fakeApi();
  const cache = sharedCache(
    { ...ENV, BAKE_SHARED_CACHE_API: "http://elsewhere", VERCEL: "1" },
    () => {},
    RUNTIME,
    api.fetcher
  ).cache;
  await cache?.get("a", "k");
  expect(
    api.calls.every((c) => c.url.startsWith("https://api.vercel.com/"))
  ).toBe(true);
});
