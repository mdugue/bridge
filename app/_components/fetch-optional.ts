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
