/**
 * The site's landmark facts (`landmark-facts.json`, lib/city/landmark-facts.ts),
 * fetched once for the page by whoever asks first — the nameplate or the
 * inquiry card — and indexed once: both read the same index, so they
 * cannot disagree. A fetch that fails or takes longer than
 * `FACTS_TIMEOUT_MS` is not kept: the next landmark asks again; a file
 * that is not one is kept as none.
 */
import {
  indexLandmarkFacts,
  isLandmarkFactsFile,
  type LandmarkFactsIndex,
} from "@/lib/city/landmark-facts";

/** How long the facts may take before the plate shows the name alone. */
const FACTS_TIMEOUT_MS = 8000;

const loads = new Map<string, Promise<LandmarkFactsIndex | null>>();

export function loadLandmarkFacts(
  url: string
): Promise<LandmarkFactsIndex | null> {
  let pending = loads.get(url);
  if (!pending) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FACTS_TIMEOUT_MS);
    pending = fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) {
          throw new Error(`landmark facts: ${r.status}`);
        }
        return r.json() as Promise<unknown>;
      })
      // a file that arrived but is not one is kept as none: asking again
      // would fetch the same; a failed or late fetch is not kept
      .then((json) => ({
        index: isLandmarkFactsFile(json) ? indexLandmarkFacts(json) : null,
      }))
      .catch(() => null)
      .then((loaded) => {
        clearTimeout(timer);
        if (!loaded) {
          loads.delete(url);
        }
        return loaded?.index ?? null;
      });
    loads.set(url, pending);
  }
  return pending;
}
