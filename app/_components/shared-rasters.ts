/**
 * Rasters more than one tile content reads, loaded once and freed when the
 * last reader lets go: the sky-view raster is read by a tile's terrain (at
 * both levels) and by its buildings (plan 033), which 3DTilesRendererJS
 * loads and unloads independently; on a phone the two terrain levels name
 * the same class, NDVI and sports rasters too. Keyed by URL. A load every
 * reader left before it landed is aborted (its `signal`).
 */
export interface SharedRasters<T> {
  /** the raster (null when absent or undecodable); one reference more */
  acquire: (key: string) => Promise<T | null>;
  /** keys currently held (tests, diagnostics) */
  held: () => number;
  /** one reference less; the last one frees it (once it has loaded) */
  release: (key: string) => void;
  /** frees every raster whatever its references (the stream's teardown);
   *  a later release of a cleared key is a no-op */
  clear: () => void;
}

export function createSharedRasters<T>(
  load: (key: string, signal: AbortSignal) => Promise<T | null>,
  free: (value: T) => void
): SharedRasters<T> {
  const entries = new Map<
    string,
    {
      controller: AbortController;
      landed: boolean;
      promise: Promise<T | null>;
      refs: number;
    }
  >();
  const freeWhenLoaded = (promise: Promise<T | null>) => {
    void promise.then((value) => {
      if (value !== null) {
        free(value);
      }
    });
  };
  return {
    acquire: (key) => {
      let entry = entries.get(key);
      if (!entry) {
        const controller = new AbortController();
        const fresh = {
          controller,
          landed: false,
          refs: 0,
          promise: load(key, controller.signal)
            .catch(() => null)
            .then((value) => {
              fresh.landed = true;
              return value;
            }),
        };
        entry = fresh;
        entries.set(key, entry);
      }
      entry.refs++;
      return entry.promise;
    },
    release: (key) => {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      entry.refs--;
      if (entry.refs > 0) {
        return;
      }
      entries.delete(key);
      if (!entry.landed) {
        entry.controller.abort();
      }
      freeWhenLoaded(entry.promise);
    },
    clear: () => {
      for (const entry of entries.values()) {
        freeWhenLoaded(entry.promise);
      }
      entries.clear();
    },
    held: () => entries.size,
  };
}
