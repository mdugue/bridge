import { afterEach, beforeEach, expect, test } from "bun:test";
import { fetchFeatures, fetchOptionalJson } from "./fetch-optional";

const realFetch = globalThis.fetch;
type FetchStub = () => Promise<{ json: () => unknown; ok: boolean }>;

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

test("fetchFeatures unwraps the collection", async () => {
  stubFetch(() =>
    Promise.resolve({ ok: true, json: () => ({ features: [1, 2] }) })
  );
  expect(await fetchFeatures<number>("/x")).toEqual([1, 2]);
});
