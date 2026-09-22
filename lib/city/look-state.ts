/**
 * The look store: the ONE current value of every look control, owned by the
 * HUD and outliving the scene. Sliders, pasted snapshots and the QA hook all
 * write through `set`; the scene subscribes and applies each change to its
 * materials, and reads `get()` whenever a tile lands later, so a late owner
 * is born with the current look instead of a default. Values are clamped
 * here, once, so no writer can push a row past its range. No THREE, no DOM.
 */
import {
  LOOK_CONTROLS,
  LOOK_DEFAULTS,
  type LookValues,
  maxValueOf,
} from "./look-controls";

export type LookListener = (values: LookValues) => void;

export interface LookState {
  /**
   * The current values — the same object until the next change, so it is
   * safe as a React external-store snapshot.
   */
  get: () => LookValues;
  /** Clamps and stores the given keys; listeners run once, only if something changed. */
  set: (patch: Partial<LookValues>) => void;
  /** Called after every change with the new values; returns the unsubscribe. */
  subscribe: (listener: LookListener) => () => void;
}

/**
 * The part of a patch the scene accepts: percent rows clamped to [0, max],
 * the focus distance to ≥ 1 m, the flags as they are. Non-finite numbers and
 * unknown keys are dropped.
 */
export function clampLook(patch: Partial<LookValues>): Partial<LookValues> {
  const out: Partial<LookValues> = {};
  for (const def of LOOK_CONTROLS) {
    const value = patch[def.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[def.key] = Math.min(Math.max(value, 0), maxValueOf(def));
    }
  }
  const distance = patch.focusDistanceM;
  if (typeof distance === "number" && Number.isFinite(distance)) {
    out.focusDistanceM = Math.max(distance, 1);
  }
  if (patch.dof !== undefined) {
    out.dof = patch.dof;
  }
  if (patch.focusMode !== undefined) {
    out.focusMode = patch.focusMode;
  }
  if (patch.multiTuft !== undefined) {
    out.multiTuft = patch.multiTuft;
  }
  return out;
}

export function createLookState(
  initial: LookValues = LOOK_DEFAULTS
): LookState {
  let current: LookValues = { ...initial };
  const listeners = new Set<LookListener>();
  return {
    get: () => current,
    set: (patch) => {
      const clamped = clampLook(patch);
      const next = { ...current };
      let changed = false;
      for (const key of Object.keys(clamped) as (keyof LookValues)[]) {
        const value = clamped[key];
        if (value !== undefined && next[key] !== value) {
          Object.assign(next, { [key]: value });
          changed = true;
        }
      }
      if (!changed) {
        return;
      }
      current = next;
      for (const listener of listeners) {
        listener(current);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
