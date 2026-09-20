/**
 * The one fetch policy for OPTIONAL artifacts (lamps, walls, rails, roof
 * colours, …): a 404, a network failure or unparseable JSON means "feature
 * off"; an abort is never swallowed — the doomed instance (StrictMode
 * remount, navigation away) must stop building geometry from partial data,
 * and the caller's ensureAlive() relies on the rejection. Required artifacts
 * (CityJSON, heightfields) throw on any failure instead.
 */

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
  const doc = await fetchOptionalJson<{ features?: T[] }>(url, signal);
  return doc?.features ?? [];
}
