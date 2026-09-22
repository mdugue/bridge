/**
 * The one fetch policy for OPTIONAL artifacts (lamps, walls, rails, roof
 * colours, …): a 404, a network failure or unparseable JSON means "feature
 * off"; an abort is never swallowed — the doomed instance (StrictMode
 * remount, navigation away) must stop building geometry from partial data,
 * and the caller's ensureAlive() relies on the rejection. Required artifacts
 * (CityJSON, heightfields) throw on any failure instead.
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

/**
 * Download progress of one artifact, 0..1. Reported off the COMPRESSED byte
 * stream, which is what `Content-Length` measures — the inflated size is not
 * known until the last chunk. A server that omits the header (chunked
 * transfer) yields no fraction at all rather than a guessed one.
 */
export type BytesProgress = (fraction: number) => void;

/**
 * Counts bytes as they arrive and reports the fraction of `total`. Typed with
 * the same chunk type `Response.body` carries, so the inflate step downstream
 * still accepts it.
 */
function countingStream(
  total: number,
  onBytes: BytesProgress
): TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>> {
  let loaded = 0;
  let reported = -1;
  return new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      // Chunks arrive far faster than anything can be shown: report whole
      // percent steps only, which is also all the HUD renders.
      const percent = Math.min(99, Math.floor((loaded / total) * 100));
      if (percent !== reported) {
        reported = percent;
        // The last chunk lands with the body still to inflate; 1 is reported
        // by the caller once the artifact is actually built.
        onBytes(percent / 100);
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Fetches a REQUIRED pre-gzipped binary artifact and inflates it in the
 * browser (native DecompressionStream). The bakes gzip binary blobs
 * themselves because static hosts only compress text-like MIME types.
 *
 * `onBytes` is the one honest progress signal the loading screen has: these
 * are the two multi-megabyte downloads the first frame waits on.
 */
export async function fetchGzipped(
  url: string,
  signal?: AbortSignal,
  onBytes?: BytesProgress
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`Failed to fetch ${url}: empty body`);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot inflate the tile data (no DecompressionStream; " +
        "needs Safari 16.4+, Chrome 80+, Firefox 113+)."
    );
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  const counted =
    onBytes && total > 0
      ? res.body.pipeThrough(countingStream(total, onBytes))
      : res.body;
  const inflated = counted.pipeThrough(new DecompressionStream("gzip"));
  return new Response(inflated).arrayBuffer();
}
