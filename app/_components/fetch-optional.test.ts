import { afterEach, expect, test } from "bun:test";
import {
  eitherSignal,
  fetchBytes,
  fetchFeatures,
  fetchFeaturesFrom,
  fetchOptionalBinary,
  fetchOptionalJson,
  fetchRequiredJson,
  untilAborted,
} from "./fetch-optional";

const realFetch = globalThis.fetch;
const realRandom = Math.random;

/** Answers every request with `answer(url, call)` (a Response, or a
 *  rejection standing in for the network). */
function stubFetch(
  answer: (url: string, call: number) => Response | Promise<Response>
): { calls: () => number } {
  let calls = 0;
  // reason: the stub takes the URL only; the helpers pass a string
  globalThis.fetch = ((url: string) => {
    calls++;
    return Promise.resolve(answer(url, calls));
  }) as unknown as typeof fetch;
  return { calls: () => calls };
}

const json = (doc: unknown) => new Response(JSON.stringify(doc));

afterEach(() => {
  globalThis.fetch = realFetch;
  Math.random = realRandom;
});

test("ok JSON is returned parsed", async () => {
  stubFetch(() => json({ a: 1 }));
  expect(await fetchOptionalJson<{ a: number }>("/x")).toEqual({ a: 1 });
});

test("a 404 means feature off, at once", async () => {
  const stub = stubFetch(() => new Response(null, { status: 404 }));
  expect(await fetchOptionalJson("/x")).toBeNull();
  expect(stub.calls()).toBe(1);
});

test("a body that is not JSON means feature off", async () => {
  stubFetch(() => new Response("<html>"));
  expect(await fetchOptionalJson("/x")).toBeNull();
});

test("a network failure is not the answer: the file is asked for again", async () => {
  // the shortest backoff (0.25 s), so the test waits for one real retry
  Math.random = () => 0;
  const stub = stubFetch((_, call) =>
    call === 1 ? Promise.reject(new TypeError("Load failed")) : json({ a: 2 })
  );
  expect(await fetchOptionalJson<{ a: number }>("/x")).toEqual({ a: 2 });
  expect(stub.calls()).toBe(2);
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
    url === "/b"
      ? new Response(null, { status: 404 })
      : json({ features: url === "/a" ? [1] : [2, 3] })
  );
  expect(await fetchFeaturesFrom<number>(["/a", "/b", "/c"])).toEqual([
    1, 2, 3,
  ]);
});

test("fetchFeaturesFrom rethrows an abort", async () => {
  const abort = new DOMException("aborted", "AbortError");
  stubFetch(() => Promise.reject(abort));
  // (bun-types declare `rejects` as void; see "an abort is rethrown")
  // oxlint-disable-next-line typescript/await-thenable
  await expect(fetchFeaturesFrom(["/a", "/b"])).rejects.toBe(abort);
});

test("fetchFeatures unwraps the collection", async () => {
  stubFetch(() => json({ features: [1, 2] }));
  expect(await fetchFeatures<number>("/x")).toEqual([1, 2]);
});

test("a binary artifact comes back as bytes, a pre-gzipped one inflated", async () => {
  const bytes = new Uint8Array([80, 84, 83, 49, 0, 1, 2, 3]);
  stubFetch(
    (url) =>
      new Response(url.endsWith(".gz") ? Bun.gzipSync(bytes) : bytes.slice())
  );
  const plain = await fetchOptionalBinary("/x.pts");
  const inflated = await fetchOptionalBinary("/x.pts.gz");
  expect(new Uint8Array(plain ?? new ArrayBuffer(0))).toEqual(bytes);
  expect(new Uint8Array(inflated ?? new ArrayBuffer(0))).toEqual(bytes);
});

test("a missing binary artifact is off; an abort is rethrown", async () => {
  stubFetch(() => new Response(null, { status: 404 }));
  expect(await fetchOptionalBinary("/x.pts.gz")).toBeNull();
  const abort = new DOMException("aborted", "AbortError");
  stubFetch(() => Promise.reject(abort));
  // (bun-types declare `rejects` as void; see "an abort is rethrown")
  // oxlint-disable-next-line typescript/await-thenable
  await expect(fetchOptionalBinary("/x.pts.gz")).rejects.toBe(abort);
});

test("fetchBytes answers a status no retry fixes as it is, without a body", async () => {
  const stub = stubFetch(() => new Response("denied", { status: 403 }));
  const got = await fetchBytes("/x", { budgetMs: 20_000 });
  expect(got).toMatchObject({ status: 403, ok: false });
  expect(got.bytes.length).toBe(0);
  expect(stub.calls()).toBe(1);
});

test("a required file that is missing throws with its status", async () => {
  stubFetch(() => new Response(null, { status: 404 }));
  // (bun-types declare `rejects` as void; see "an abort is rethrown")
  // oxlint-disable-next-line typescript/await-thenable
  await expect(fetchRequiredJson("/tileset.json")).rejects.toThrow(
    "Failed to fetch /tileset.json: HTTP 404"
  );
});

test("either signal aborts the merged one; released, neither does", () => {
  const a = new AbortController();
  const b = new AbortController();
  const merged = eitherSignal(a.signal, b.signal);
  b.abort();
  expect(merged.signal.aborted).toBe(true);
  const c = new AbortController();
  const d = new AbortController();
  const released = eitherSignal(c.signal, d.signal);
  released.release();
  c.abort();
  expect(released.signal.aborted).toBe(false);
  expect(eitherSignal(undefined, d.signal).signal).toBe(d.signal);
});

test("an abort ends the wait at once, the work behind it going on for whoever else waits", async () => {
  let land: (value: string) => void = () => undefined;
  const shared = new Promise<string>((resolve) => {
    land = resolve;
  });
  const aborter = new AbortController();
  const waiting = untilAborted(shared, aborter.signal);
  aborter.abort();
  // (bun-types declare `rejects` as void; see "an abort is rethrown")
  // oxlint-disable-next-line typescript/await-thenable
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  land("raster");
  expect(await shared).toBe("raster");
  // without an abort: the answer, or the failure, as it comes
  const fresh = new AbortController();
  expect(await untilAborted(Promise.resolve(1), fresh.signal)).toBe(1);
  const failure = new Error("decode");
  // oxlint-disable-next-line typescript/await-thenable
  await expect(
    untilAborted(Promise.reject(failure), fresh.signal)
  ).rejects.toBe(failure);
});
