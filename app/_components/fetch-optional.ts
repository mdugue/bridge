/**
 * The one fetch policy for OPTIONAL artifacts (lamps, walls, rails, roof
 * colours, …): a 404, a network failure or unparseable JSON means "feature
 * off"; an abort is never swallowed — the doomed instance (StrictMode
 * remount, navigation away) must stop building geometry from partial data,
 * and the caller's ensureAlive() relies on the rejection. Required artifacts
 * (the tileset) throw on any failure instead.
 */

import type { FeatureCollection } from "@/lib/city/features";

/** True for the DOMException a fetch throws when its AbortSignal fires. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Fetches an optional JSON artifact; null = feature off. Rethrows aborts. */
export async function fetchOptionalJson<T>(
  url: string,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * Whether `bytes` are still gzipped. The pre-gzipped artifacts (`.glb.gz`,
 * `.pts.gz`) are judged on the magic, not the URL: a host that serves `.gz`
 * with `Content-Encoding: gzip` has the browser inflate them already.
 */
export function isGzipped(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** `bytes` inflated natively, as a stream. */
export function gunzip(
  bytes: Uint8Array<ArrayBuffer>
): ReadableStream<Uint8Array> {
  return new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
}

/**
 * Fetches an optional binary artifact; null = feature off. Rethrows aborts.
 * A pre-gzipped one (`.gz`) is inflated here (isGzipped), as the tiles'
 * glTF is (tile-stream.ts).
 */
export async function fetchOptionalBinary(
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!isGzipped(bytes)) {
      return bytes.buffer;
    }
    return await new Response(gunzip(bytes)).arrayBuffer();
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/** The `features` of an optional GeoJSON FeatureCollection, or []. */
export async function fetchFeatures<T>(
  url: string | undefined,
  signal?: AbortSignal
): Promise<T[]> {
  if (!url) {
    return [];
  }
  const doc = await fetchOptionalJson<FeatureCollection<T>>(url, signal);
  return doc?.features ?? [];
}

/** The features of several optional collections, merged in URL order. */
export async function fetchFeaturesFrom<T>(
  urls: string[],
  signal?: AbortSignal
): Promise<T[]> {
  const lists = await Promise.all(
    urls.map((url) => fetchFeatures<T>(url, signal))
  );
  return lists.flat();
}

/** Fetches a REQUIRED JSON artifact; any failure throws. */
export async function fetchRequiredJson<T>(
  url: string,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
