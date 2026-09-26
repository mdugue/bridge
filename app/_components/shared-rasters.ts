/**
 * Rasters more than one tile content reads, loaded once and freed when the
 * last reader lets go: the sky-view raster is read by a tile's terrain (at
 * both levels) and by its buildings (plan 033), which 3DTilesRendererJS
 * loads and unloads independently. Keyed by URL.
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
  load: (key: string) => Promise<T | null>,
  free: (value: T) => void
): SharedRasters<T> {
  const entries = new Map<
    string,
    { promise: Promise<T | null>; refs: number }
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
        entry = { refs: 0, promise: load(key).catch(() => null) };
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
