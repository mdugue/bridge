import type { LookState } from "@/lib/city/look-state";

/**
 * The seam between the spine (create-app.ts: renderer, stream, post stack,
 * render loop, the scene's clock) and the optional features that start on
 * their first use (plan 074 part B): the data layers
 * (data-layers-feature.ts). The spine emits; a feature, once started,
 * listens, and lets go when it is disposed — the spine does not wire it by
 * hand. Everything here lives per boot: nothing is module state, so a
 * remount or a recovered page starts clean.
 *
 * A feature's code still ships with the scene: as a chunk of its own
 * (`import()`), the data layers made the viewer's first-load JS 22.7 KB
 * gz larger while moving 10.1 KB out — three.js, imported by both chunks,
 * lost its scope hoisting with the scene's code (ADR 0051). The importer
 * create-app.ts hands `lazyFeature` is where an `import()` would go.
 */

/** An event of the spine a feature can listen to. */
export interface Hook<A extends unknown[]> {
  /** `listener` hears every emit from now on, until the returned call */
  on: (listener: (...args: A) => void) => () => void;
}

/** A hook and its trigger: the spine's half. */
export interface Emitter<A extends unknown[]> extends Hook<A> {
  emit: (...args: A) => void;
}

export function createHook<A extends unknown[]>(): Emitter<A> {
  const listeners = new Set<(...args: A) => void>();
  return {
    on: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (...args) => {
      for (const listener of listeners) {
        listener(...args);
      }
    },
  };
}

/**
 * A value of the spine that changes, read where a feature starts and heard
 * on every change after: a feature that arrives late has missed the
 * changes before it (the look store is one already).
 */
export interface Watch<T> {
  get: () => T;
  subscribe: (listener: (value: T) => void) => () => void;
}

/** A watched value and its setter: the spine's half. */
export interface Watched<T> extends Watch<T> {
  set: (value: T) => void;
}

export function createWatch<T>(initial: T): Watched<T> {
  let value = initial;
  const changed = createHook<[T]>();
  return {
    get: () => value,
    subscribe: changed.on,
    set: (next) => {
      value = next;
      changed.emit(next);
    },
  };
}

/** The scene's instant as the HUD set it last (its sun and time). */
export interface SceneClock {
  date: Date;
  /** performance.now() when it was set: the clock runs on from there */
  atMs: number;
}

/** What the spine lets a feature hook into. */
export interface SpineHooks {
  /** every rendered frame: the loop's clock (s) and performance.now() */
  frame: Hook<[elapsed: number, nowMs: number]>;
  /** the tile set changed, once per task (the ground has followed it) */
  streamChange: Hook<[]>;
  /** the look store (lib/city/look-state.ts) */
  look: Pick<LookState, "get" | "subscribe">;
  /** the scene's instant */
  clock: Watch<SceneClock>;
}

/** A feature that starts once, the first time it is wanted. */
export interface LazyFeature<F> {
  /** loads the module and starts the feature, once: resolves to it, or to
   *  null once the spine is gone. A load that fails rejects, and the next
   *  call tries again; a start that throws rejects for good. */
  want: () => Promise<F | null>;
  /** the feature, once it has started */
  current: () => F | null;
  /** stops the feature, or keeps one still loading from starting */
  dispose: () => void;
}

/**
 * A feature whose module comes with `importer` and starts with `start` once
 * it has — always after the call that wanted it has returned, never inside
 * it (the importer's promise resolves in a later microtask at the soonest).
 */
export function lazyFeature<M, F extends { dispose: () => void }>(
  importer: () => Promise<M>,
  start: (module: M) => F
): LazyFeature<F> {
  let feature: F | null = null;
  let pending: Promise<F | null> | null = null;
  let disposed = false;
  return {
    want: () => {
      pending ??= importer().then(
        (module) => {
          if (disposed) {
            return null;
          }
          feature ??= start(module);
          return feature;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        }
      );
      return pending;
    },
    current: () => feature,
    dispose: () => {
      disposed = true;
      feature?.dispose();
      feature = null;
    },
  };
}
