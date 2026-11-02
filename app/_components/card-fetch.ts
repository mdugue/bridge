/**
 * The files an inquiry card fetches when it first needs them, never at
 * boot: one fetch per URL for the page's life (the files are
 * content-hashed and immutable, ADR 0024); a failed one is not kept, so
 * the next card tries again. The nameplate (nameplate-ask.ts) reads a
 * tree's facts through the same cache, so card and plate fetch a tile's
 * file once between them and name the tree alike.
 */
import type { TreeFactsFile } from "@/lib/city/features";

export function cachedFetch<T>(
  cache: Map<string, Promise<T | null>>,
  url: string,
  accept: (json: unknown) => json is T
): Promise<T | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((json) => (accept(json) ? json : null))
      .catch(() => null)
      .then((value) => {
        if (!value) {
          cache.delete(url);
        }
        return value;
      });
    cache.set(url, pending);
  }
  return pending;
}

/** The tiles' tree facts files (ADR 0042), by URL. */
export const treeFactsFetches = new Map<
  string,
  Promise<TreeFactsFile | null>
>();

export const isTreeFacts = (json: unknown): json is TreeFactsFile =>
  typeof json === "object" &&
  json !== null &&
  Array.isArray((json as Partial<TreeFactsFile>).known) &&
  Array.isArray((json as Partial<TreeFactsFile>).names);

/** A tile's tree facts file, from the shared cache. */
export function loadTreeFacts(url: string): Promise<TreeFactsFile | null> {
  return cachedFetch(treeFactsFetches, url, isTreeFacts);
}
