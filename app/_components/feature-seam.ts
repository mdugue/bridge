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
 * A feature's code ships with the scene, so there is nothing to load: as
 * a chunk of its own (`import()`) the data layers cost more first-load JS
 * than they moved in 2026-10 (three.js lost its scope hoisting, ADR 0040),
 * and measured again in 2026-11, with three in chunks of its own, the
 * viewer's JS came out 0.5 kB larger and the chunk was fetched at the
 * boot all the same.
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

/**
 * Follows a watched value: `listener` hears the current value at once and
 * every change after, until the returned call — the read-then-subscribe a
 * late starter does, in one synchronous step.
 */
export function follow<T>(
  watch: Pick<Watch<T>, "get" | "subscribe">,
  listener: (value: T) => void
): () => void {
  listener(watch.get());
  return watch.subscribe(listener);
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
export interface StartedOnce<F> {
  /** starts the feature, once: resolves to it, or to null once the spine
   *  is gone. A start that throws rejects, this want and every later one. */
  want: () => Promise<F | null>;
  /** the feature, once it has started */
  current: () => F | null;
  /** stops the feature, or keeps one not yet started from starting */
  dispose: () => void;
}

/**
 * A feature that starts with `start` the first time it is wanted — always
 * after the call that wanted it has returned, never inside it (in a later
 * microtask), so a spine still setting itself up has finished by then.
 */
export function startOnce<F extends { dispose: () => void }>(
  start: () => F
): StartedOnce<F> {
  let feature: F | null = null;
  let pending: Promise<F | null> | null = null;
  let disposed = false;
  return {
    want: async () => {
      // (a start that resolved before the spine went would hand out the
      // stopped feature)
      if (disposed) {
        return null;
      }
      pending ??= Promise.resolve().then(() => {
        if (disposed) {
          return null;
        }
        feature = start();
        return feature;
      });
      return await pending;
    },
    current: () => feature,
    dispose: () => {
      disposed = true;
      feature?.dispose();
      feature = null;
    },
  };
}

/**
 * The spine's want of a feature that serves several switches (the data
 * layers): called with whether any of them is on, it wants the feature on
 * each switch-on — none on before — and not on every change while one is,
 * and `failed` hears each want that did not start it (once a switch-on,
 * not once a slider's step).
 */
export function wantOnSwitchOn(
  feature: Pick<StartedOnce<unknown>, "want">,
  failed: (error: unknown) => void
): (on: boolean) => void {
  let wasOn = false;
  return (on) => {
    if (on && !wasOn) {
      feature.want().catch(failed);
    }
    wasOn = on;
  };
}
