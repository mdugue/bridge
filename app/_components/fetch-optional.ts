/**
 * The one fetch policy for the viewer's files. The scene's requests — the
 * manifest, the tileset and every tile, their side files and rasters
 * (raster-upload.ts `fetchRasterBytes`), the trees' NDVI sampler — go
 * through `fetchBytes`: a network failure (or a 408/429/5xx) is retried
 * with backoff for a budget of the page's visible time
 * (lib/city/fetch-retry.ts, net-gate.ts), the body read inside the
 * retries, so a blip — a Wi-Fi handover, a resume from the background — is
 * never taken for the answer.
 * Not yet: the minimap's rasters and the inquiry card's facts fetch
 * directly (a failure there is that widget's), and the
 * reports' beacons are fire-and-forget.
 *
 * OPTIONAL artifacts (lamps, walls, rails, roof colours, a live feed, …):
 * a 404, unparseable JSON or a failure that outlasts their short budget
 * means "feature off". (lib/city/tile.ts names only files a tile has, so a
 * 404 there is a deploy fault rather than an absence.) An abort is never
 * swallowed — the doomed instance (StrictMode remount, navigation away)
 * must stop building geometry from partial data, and the caller's
 * ensureAlive() relies on the rejection. REQUIRED artifacts (the tileset)
 * throw instead, after the boot's longer wait for the network.
 */

import type { FeatureCollection } from "@/lib/city/features";
import {
  BOOT_NET_WAIT_MS,
  OPTIONAL_FETCH_BUDGET_MS,
  withRetry,
} from "@/lib/city/fetch-retry";
import { PAGE_RETRY_ENV, reportRetry } from "./net-gate";

/** True for the DOMException a fetch throws when its AbortSignal fires. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
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

/** What `fetchBytes` got: the final status and, when it is ok, the body. */
export interface FetchedBytes {
  /** a 2xx, or a status no retry fixes (404, 403, …) */
  status: number;
  ok: boolean;
  /** the body (inflated when asked to and gzipped); empty unless ok */
  bytes: Uint8Array<ArrayBuffer>;
}

export interface FetchBytesOptions {
  signal?: AbortSignal;
  /** how long transient failures are retried, in ms of a visible page */
  budgetMs: number;
  /** inflate a gzipped body (`inflate`) */
  gunzip?: boolean;
  /** the rest of the request (`cache`, headers) */
  init?: RequestInit;
  /** how long an attempt may go without a byte (default `STALL_MS`) */
  stallMs?: number;
}

const NO_BYTES = new Uint8Array(0);

/**
 * A gzipped body, inflated. It has been read whole by then — a body cut
 * off in transit fails its read, which is retried — so one that does not
 * inflate is a corrupt file (a broken upload, a proxy that mangled it):
 * rethrown as a plain Error, not the TypeError the stream rejects with,
 * which the retries and the tile healer would take for the network's and
 * fetch again for ever. (A tile's load-error names the URL itself.)
 */
async function inflate(
  raw: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await new Response(gunzip(raw)).arrayBuffer());
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`Corrupt gzip: ${why}`, { cause: err });
  }
}

/**
 * How long one attempt may go without a byte — before its headers, or
 * between two chunks of its body — before it counts as failed and is
 * tried again. A browser leaves a request whose connection went silent
 * (a captive Wi-Fi, a mobile handover) pending for minutes, and the boot
 * waited on it: the bar stood still with nothing left to retry. A slow
 * link that keeps delivering is never cut.
 */
export const STALL_MS = 30_000;

/** An attempt that went silent (`STALL_MS`): the network's, so retried. */
class StalledError extends Error {
  readonly transient = true;
  constructor(url: string, ms: number) {
    super(`No data from ${url} for ${ms / 1000} s`);
    this.name = "StalledError";
  }
}

/** The body read chunk by chunk, each chunk proof of life (`touch`). */
async function readBody(
  res: Response,
  touch: () => void
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = res.body?.getReader();
  if (!reader) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    touch();
    chunks.push(value);
    size += value.byteLength;
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/**
 * One attempt at `url` under the stall guard: its own abort, fired by the
 * caller's signal or by `STALL_MS` without a byte — the latter rethrown as
 * a `StalledError`, which the retries take for the network's.
 */
async function attempt(
  url: string,
  opts: FetchBytesOptions
): Promise<{
  status: number;
  retryAfter?: string | null;
  value: Uint8Array<ArrayBuffer>;
}> {
  const stall = new AbortController();
  const { signal, release } = eitherSignal(opts.signal, stall.signal);
  const stallMs = opts.stallMs ?? STALL_MS;
  let timer = setTimeout(() => stall.abort(), stallMs);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stall.abort(), stallMs);
  };
  try {
    const res = await fetch(url, { ...opts.init, signal });
    touch();
    if (!res.ok) {
      // an error page's body is never read
      void res.body?.cancel().catch(() => undefined);
      return {
        status: res.status,
        retryAfter: res.headers.get("retry-after"),
        value: NO_BYTES,
      };
    }
    const raw = await readBody(res, touch);
    const bytes = opts.gunzip && isGzipped(raw) ? await inflate(raw) : raw;
    return { status: res.status, value: bytes };
  } catch (err) {
    if (stall.signal.aborted && !opts.signal?.aborted) {
      throw new StalledError(url, stallMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    release();
  }
}

/**
 * Fetches `url` and reads its body, retrying network failures, stalls
 * (`STALL_MS`) and transient statuses (lib/city/fetch-retry.ts
 * `withRetry`): resolves with the final status — the body only when it is
 * ok —, rejects with an AbortError on abort, the error itself when it is
 * not the network's, or a NetworkError (`transient`, `attempts`) once the
 * budget is spent.
 */
export async function fetchBytes(
  url: string,
  opts: FetchBytesOptions
): Promise<FetchedBytes> {
  const { signal, budgetMs } = opts;
  const answer = await withRetry(() => attempt(url, opts), {
    budgetMs,
    env: PAGE_RETRY_ENV,
    signal,
    onRetry: reportRetry,
  });
  return {
    status: answer.status,
    ok: answer.status >= 200 && answer.status < 300,
    bytes: answer.value,
  };
}

/**
 * One signal that aborts with either of two; `release` drops its listeners
 * once the work is done (the plugin's own signal outlives every fetch).
 */
export function eitherSignal(
  a: AbortSignal | null | undefined,
  b: AbortSignal
): { signal: AbortSignal; release: () => void } {
  if (!a) {
    return { signal: b, release: () => undefined };
  }
  const both = new AbortController();
  const abort = () => both.abort();
  const release = () => {
    a.removeEventListener("abort", abort);
    b.removeEventListener("abort", abort);
  };
  if (a.aborted || b.aborted) {
    both.abort();
  } else {
    a.addEventListener("abort", abort, { once: true });
    b.addEventListener("abort", abort, { once: true });
  }
  return { signal: both.signal, release };
}

/**
 * `promise`, or a rejection with the abort as soon as `signal` fires: the
 * caller stops waiting (and lets go of what it holds) at once, while the
 * work behind `promise` goes on for whoever else waits for it — a shared
 * raster (shared-rasters.ts) is aborted only once its last holder lets go.
 */
export function untilAborted<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    return promise;
  }
  let abort = (): void => undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted.", "AbortError")
      );
  });
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }
  return Promise.race([promise, aborted]).finally(() => {
    signal.removeEventListener("abort", abort);
  });
}

/** An optional file's bytes, or null (off); rethrows aborts. */
async function optionalBytes(
  url: string,
  signal: AbortSignal | undefined,
  inflate: boolean
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const got = await fetchBytes(url, {
      signal,
      budgetMs: OPTIONAL_FETCH_BUDGET_MS,
      gunzip: inflate,
    });
    return got.ok ? got.bytes : null;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Fetches an optional JSON artifact; null = feature off. Rethrows aborts. */
export async function fetchOptionalJson<T>(
  url: string,
  signal?: AbortSignal
): Promise<T | null> {
  const bytes = await optionalBytes(url, signal, false);
  if (!bytes) {
    return null;
  }
  try {
    return parseJson<T>(bytes);
  } catch {
    return null;
  }
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
  const bytes = await optionalBytes(url, signal, true);
  return bytes ? bytes.buffer : null;
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

/**
 * Fetches a REQUIRED JSON artifact: retried while the network is down for
 * up to the boot's wait (ms of a visible page), then — or on any other
 * failure — it throws (a give-up's message starts "network: ").
 */
export async function fetchRequiredJson<T>(
  url: string,
  signal?: AbortSignal
): Promise<T> {
  const got = await fetchBytes(url, { signal, budgetMs: BOOT_NET_WAIT_MS });
  if (!got.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${got.status}`);
  }
  return parseJson<T>(got.bytes);
}
