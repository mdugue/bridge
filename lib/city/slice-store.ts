/**
 * A store of named slices, each with its own listeners: what the scene
 * reports to the HUD (app/_components/scene-status.ts) lives in one, so a
 * widget hears only of the slice it shows — a frame-rate report re-renders
 * the counter, not the whole HUD. Shaped like the look store
 * (look-state.ts), whose `get` is safe as a React external-store snapshot:
 * a slice is the same value until a write changes it.
 *
 * A write that equals the slice's value (by the slice's `equals`, Object.is
 * where none is given) changes nothing and notifies no one. A write is
 * read back at once; its listeners run once per slice and burst — at once
 * without a `schedule`, or in the task `schedule` runs the flush in, so a
 * report from inside a frame is heard after it. No THREE, no DOM, no React.
 */

export type SliceListener<V> = (value: V) => void;

export type SliceEquals<S> = { [K in keyof S]?: (a: S[K], b: S[K]) => boolean };

export interface SliceStoreOptions<S> {
  /** per slice: when a write leaves it unchanged (default `Object.is`) */
  equals?: SliceEquals<S>;
  /**
   * Runs the store's flush later (the HUD: the next task); every slice
   * written meanwhile is heard once, with its value then. Without it the
   * listeners run inside `set`.
   */
  schedule?: (flush: () => void) => void;
}

export interface SliceStore<S> {
  /** the slice's current value — the same until a write changes it */
  get: <K extends keyof S>(key: K) => S[K];
  /** stores the value unless it equals the current one; true if it changed */
  set: <K extends keyof S>(key: K, value: S[K]) => boolean;
  /** `set` with a value made from the current one */
  update: <K extends keyof S>(key: K, next: (current: S[K]) => S[K]) => boolean;
  /** called after the slice changes, with its value; returns the unsubscribe */
  subscribe: <K extends keyof S>(
    key: K,
    listener: SliceListener<S[K]>
  ) => () => void;
}

export function createSliceStore<S extends object>(
  initial: S,
  options: SliceStoreOptions<S> = {}
): SliceStore<S> {
  const values: S = { ...initial };
  const listeners = new Map<keyof S, Set<SliceListener<never>>>();
  const pending = new Set<keyof S>();
  let scheduled = false;

  const notify = (key: keyof S) => {
    const own = listeners.get(key);
    if (!own) {
      return;
    }
    // a copy: a listener may unsubscribe itself, or another, as it runs
    for (const listener of Array.from(own)) {
      (listener as SliceListener<S[keyof S]>)(values[key]);
    }
  };
  const flush = () => {
    scheduled = false;
    const keys = [...pending];
    pending.clear();
    for (const key of keys) {
      notify(key);
    }
  };

  const set = <K extends keyof S>(key: K, value: S[K]): boolean => {
    const equals = options.equals?.[key] ?? Object.is;
    if (equals(values[key], value)) {
      return false;
    }
    values[key] = value;
    if (!options.schedule) {
      notify(key);
      return true;
    }
    pending.add(key);
    if (!scheduled) {
      scheduled = true;
      options.schedule(flush);
    }
    return true;
  };

  return {
    get: (key) => values[key],
    set,
    update: (key, next) => set(key, next(values[key])),
    subscribe: (key, listener) => {
      let own = listeners.get(key);
      if (!own) {
        own = new Set();
        listeners.set(key, own);
      }
      own.add(listener);
      return () => {
        own.delete(listener);
      };
    },
  };
}

/**
 * Equal as plain data: primitives by `Object.is`, arrays element by element,
 * plain objects key by key — a report rebuilt each tick with the same
 * numbers (Modell's view while it stands still, the trams' count) is the
 * same report. Not for class instances, maps or cycles.
 */
export function dataEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => dataEqual(item, b[i]))
    );
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (key) =>
        Object.hasOwn(b, key) &&
        dataEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key]
        )
    )
  );
}
