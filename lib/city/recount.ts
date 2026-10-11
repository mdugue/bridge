/**
 * A count over the scene taken again only once what it counts may have
 * changed (create-app.ts: the geometry and the tiles' CPU arrays that the
 * stats and the crash trail's heartbeat report — each a walk of the whole
 * scene, which the heartbeat took every 2 s while nothing had changed).
 * `changed` marks it; `get` counts when it is marked, or when its `key` —
 * a cheap fingerprint of what no mark reaches — is not the last count's.
 * No THREE, no DOM.
 */
export interface Recount<T> {
  /** what it counts may have changed: the next `get` counts again */
  changed: () => void;
  get: (key?: number) => T;
}

export function createRecount<T>(count: () => T): Recount<T> {
  let last: { key: number; value: T } | null = null;
  return {
    changed: () => {
      last = null;
    },
    get: (key = 0) => {
      if (last?.key !== key) {
        // (a count that throws leaves it marked)
        last = { key, value: count() };
      }
      return last.value;
    },
  };
}
