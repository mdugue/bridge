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
 * report from inside a frame is heard after it. A listener that throws
 * keeps no other from hearing: every listener of the burst runs, and the
 * first error is thrown after them. No THREE, no DOM, no React.
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

  /** Runs the slice's listeners; what they throw is kept in `errors`. */
  const notify = (key: keyof S, errors: unknown[]) => {
    const own = listeners.get(key);
    if (!own) {
      return;
    }
    // a copy: a listener may unsubscribe itself, or another, as it runs
    for (const listener of Array.from(own)) {
      try {
        (listener as SliceListener<S[keyof S]>)(values[key]);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  /** Notifies the slices, then throws the first error any listener threw. */
  const notifyAll = (keys: Iterable<keyof S>) => {
    const errors: unknown[] = [];
    for (const key of keys) {
      notify(key, errors);
    }
    if (errors.length > 0) {
      throw errors[0];
    }
  };
  const flush = () => {
    scheduled = false;
    const keys = [...pending];
    pending.clear();
    notifyAll(keys);
  };

  const set = <K extends keyof S>(key: K, value: S[K]): boolean => {
    const equals = options.equals?.[key] ?? Object.is;
    if (equals(values[key], value)) {
      return false;
    }
    values[key] = value;
    if (!options.schedule) {
      notifyAll([key]);
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
 * same report. Anything else — a `Date`, a `Map` or `Set`, a class
 * instance — is equal only to itself: its own keys say nothing of its
 * value (two dates have none), so two of them never count as one. Not for
 * cycles.
 */
export function dataEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => dataEqual(item, b[i]))
    );
  }
  return isPlainObject(a) && isPlainObject(b) && sameEntries(a, b);
}

/** An object literal (or one made without a prototype), not an instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The same own keys, each with `dataEqual` values. */
function sameEntries(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((key) => Object.hasOwn(b, key) && dataEqual(a[key], b[key]))
  );
}
