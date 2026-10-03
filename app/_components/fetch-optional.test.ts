import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  fetchFeatures,
  fetchFeaturesFrom,
  fetchOptionalBinary,
  fetchOptionalJson,
} from "./fetch-optional";

const realFetch = globalThis.fetch;
type FetchStub = (url: string) => Promise<{ json: () => unknown; ok: boolean }>;

function stubFetch(impl: FetchStub): void {
  // reason: the test only needs the subset of Response the helper reads
  globalThis.fetch = impl as unknown as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("ok JSON is returned parsed", async () => {
  stubFetch(() => Promise.resolve({ ok: true, json: () => ({ a: 1 }) }));
  expect(await fetchOptionalJson<{ a: number }>("/x")).toEqual({ a: 1 });
});

test("a 404 means feature off", async () => {
  stubFetch(() => Promise.resolve({ ok: false, json: () => ({}) }));
  expect(await fetchOptionalJson("/x")).toBeNull();
});

test("a network failure means feature off", async () => {
  stubFetch(() => Promise.reject(new TypeError("network")));
  expect(await fetchOptionalJson("/x")).toBeNull();
});

test("an abort is rethrown", async () => {
  const abort = new DOMException("aborted", "AbortError");
  stubFetch(() => Promise.reject(abort));
  // bun-types declare the `rejects` matchers as void, but bun resolves them
  // asynchronously — dropping the await would end the test before it runs.
  // oxlint-disable-next-line typescript/await-thenable
  await expect(fetchOptionalJson("/x")).rejects.toBe(abort);
});

test("fetchFeatures without a URL yields nothing", async () => {
  expect(await fetchFeatures(undefined)).toEqual([]);
});

test("fetchFeaturesFrom merges the collections in URL order, a 404 among them contributing nothing", async () => {
  stubFetch((url) =>
    Promise.resolve(
      url === "/b"
        ? { ok: false, json: () => null }
        : { ok: true, json: () => ({ features: url === "/a" ? [1] : [2, 3] }) }
    )
  );
  expect(await fetchFeaturesFrom<number>(["/a", "/b", "/c"])).toEqual([
    1, 2, 3,
  ]);
});

test("fetchFeaturesFrom rethrows an abort", async () => {
  const abort = new DOMException("aborted", "AbortError");
  stubFetch(() => Promise.reject(abort));
  // bun-types declare the `rejects` matchers as void, but bun resolves them
  // asynchronously — dropping the await would end the test before it runs.
  // oxlint-disable-next-line typescript/await-thenable
  await expect(fetchFeaturesFrom(["/a", "/b"])).rejects.toBe(abort);
});

test("fetchFeatures unwraps the collection", async () => {
  stubFetch(() =>
    Promise.resolve({ ok: true, json: () => ({ features: [1, 2] }) })
  );
  expect(await fetchFeatures<number>("/x")).toEqual([1, 2]);
});

test("a binary artifact comes back as bytes, a pre-gzipped one inflated", async () => {
  const bytes = new Uint8Array([80, 84, 83, 49, 0, 1, 2, 3]);
  // reason: a real Response, one per call, stands in for the network
  globalThis.fetch = ((url: string) =>
    Promise.resolve(
      new Response(url.endsWith(".gz") ? Bun.gzipSync(bytes) : bytes.slice())
    )) as unknown as typeof fetch;
  const plain = await fetchOptionalBinary("/x.pts");
  const inflated = await fetchOptionalBinary("/x.pts.gz");
  expect(new Uint8Array(plain ?? new ArrayBuffer(0))).toEqual(bytes);
  expect(new Uint8Array(inflated ?? new ArrayBuffer(0))).toEqual(bytes);
});

test("a missing binary artifact is off; an abort is rethrown", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, { status: 404 })
    )) as unknown as typeof fetch;
  expect(await fetchOptionalBinary("/x.pts.gz")).toBeNull();
  const abort = new DOMException("aborted", "AbortError");
  globalThis.fetch = (() => Promise.reject(abort)) as unknown as typeof fetch;
  // (bun-types declare `rejects` as void; see "an abort is rethrown")
  // oxlint-disable-next-line typescript/await-thenable
  await expect(fetchOptionalBinary("/x.pts.gz")).rejects.toBe(abort);
});
