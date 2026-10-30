import { expect, test } from "bun:test";
import { artifactHash, sharedCache } from "./shared-cache";

const bytes = (text: string) => new TextEncoder().encode(text);

/** A Remote Cache in memory, answering as the artifacts API does. */
function fakeApi(opts: { putStatus?: number } = {}) {
  const store = new Map<string, Uint8Array<ArrayBuffer>>();
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("Authorization");
    calls.push({ auth, method, url });
    const hash = new URL(url).pathname.split("/").pop() ?? "";
    if (method === "PUT") {
      const status = opts.putStatus ?? 202;
      if (status < 300) {
        store.set(hash, new Uint8Array(init?.body as Uint8Array));
      }
      return new Response(status < 300 ? "{}" : "too large", { status });
    }
    const found = store.get(hash);
    return found ? new Response(found) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher, store };
}

test("off without a token or when switched off", () => {
  expect(sharedCache({}, () => {}).cache).toBeNull();
  expect(
    sharedCache(
      { BAKE_SHARED_CACHE: "0", VERCEL_ARTIFACTS_TOKEN: "t" },
      () => {}
    ).cache
  ).toBeNull();
});

test("an entry stored by one branch is fetched by another", async () => {
  const api = fakeApi();
  const env = { VERCEL_ARTIFACTS_OWNER: "team_x", VERCEL_ARTIFACTS_TOKEN: "t" };
  const first = sharedCache(env, () => {}, api.fetcher).cache;
  expect(await first?.get("city_a.glb.gz", "k1")).toBeNull();
  await first?.put("city_a.glb.gz", "k1", bytes("baked"));

  const second = sharedCache(env, () => {}, api.fetcher).cache;
  const got = await second?.get("city_a.glb.gz", "k1");
  expect(got && new TextDecoder().decode(got)).toBe("baked");
  // another key, another name: their own entries
  expect(await second?.get("city_a.glb.gz", "k2")).toBeNull();
  expect(await second?.get("city_b.glb.gz", "k1")).toBeNull();
  expect(second?.stats()).toEqual({ bytes: 5, hits: 1, misses: 2, stored: 0 });
  expect(api.calls.every((c) => c.auth === "Bearer t")).toBe(true);
  expect(api.calls.every((c) => c.url.endsWith("?teamId=team_x"))).toBe(true);
});

test("a failed upload stops uploads for the run and never throws", async () => {
  const api = fakeApi({ putStatus: 413 });
  const lines: string[] = [];
  const cache = sharedCache(
    { TURBO_TOKEN: "t" },
    (line) => lines.push(line),
    api.fetcher
  ).cache;
  await cache?.put("a", "k", bytes("x"));
  await cache?.put("b", "k", bytes("y"));
  expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("no more uploads");
});

test("a network failure reads as a miss", async () => {
  const lines: string[] = [];
  const cache = sharedCache(
    { VERCEL_ARTIFACTS_TOKEN: "t" },
    (line) => lines.push(line),
    (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch
  ).cache;
  expect(await cache?.get("a", "k")).toBeNull();
  expect(lines[0]).toContain("offline");
});

test("the hash is hex and differs by name and key", () => {
  const a = artifactHash("a", "k");
  expect(a).toMatch(/^[0-9a-f]{64}$/u);
  expect(artifactHash("b", "k")).not.toBe(a);
  expect(artifactHash("a", "j")).not.toBe(a);
});
