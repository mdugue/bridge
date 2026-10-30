import { expect, test } from "bun:test";
import { artifactHash, sealed, sharedCache, unsealed } from "./shared-cache";

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
  await first?.put("city_a.glb.gz", "k1", bytes("baked"));
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
  await old?.put("a", "k", bytes("x"));
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
    artifactHash("a", "k", RUNTIME),
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
  await cache?.put("big", "k", bytes("x".repeat(100)));
  await cache?.put("small", "k", bytes("y"));
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
  await cache?.put("f", "k", bytes("x"));
  await cache?.flush();
  // three requests, then none
  expect(api.calls).toHaveLength(3);
  expect(lines.at(-1)).toContain("not asked again");
});

test("the address is hex and differs by name, key and runtime", () => {
  const a = artifactHash("a", "k", RUNTIME);
  expect(a).toMatch(/^[0-9a-f]{64}$/u);
  expect(artifactHash("b", "k", RUNTIME)).not.toBe(a);
  expect(artifactHash("a", "j", RUNTIME)).not.toBe(a);
  expect(artifactHash("a", "k", "bun 1.4.4 linux-x64")).not.toBe(a);
});
