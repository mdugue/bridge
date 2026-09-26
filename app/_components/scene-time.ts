/**
 * The scene's instant as the HUD holds it: a calendar day and a
 * minutes-of-day slider, the sun state the scene answered with, and the one
 * way to change them — which also tells the scene. A remount boots the new
 * scene at the current instant, not at the page's first one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SunState } from "./sun-rig";

/** 14:00, the time the page opens at. */
export const INITIAL_MINUTES = 14 * 60;

/** Local-time instant from a calendar day + minutes-of-day slider. */
export function composeDate(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
}

/** The calendar day and minutes-of-day of an instant. */
export function splitDate(date: Date): { day: Date; minutes: number } {
  return {
    day: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    minutes: date.getHours() * 60 + date.getMinutes(),
  };
}

export interface SceneTime {
  day: Date;
  minutes: number;
  /** the instant day + minutes name */
  date: Date;
  /** the scene's answer to the last instant it was given */
  sun: SunState | null;
  /** moves the scene to a day and minute */
  set: (day: Date, minutes: number) => void;
  /** moves the scene to an instant (to the minute the sliders can show) */
  setInstant: (date: Date) => void;
  /** tells a (new) scene the current instant */
  sync: () => void;
  /** the current instant, for a scene that boots */
  current: () => Date;
}

/** `apply` hands an instant to the scene, which answers with its sun (or
 *  nothing while there is no scene). */
export function useSceneTime(
  apply: (date: Date) => SunState | undefined,
  initialDay: Date
): SceneTime {
  const [day, setDay] = useState(initialDay);
  const [minutes, setMinutes] = useState(INITIAL_MINUTES);
  const [sun, setSun] = useState<SunState | null>(null);
  const date = useMemo(() => composeDate(day, minutes), [day, minutes]);
  // Written by `set` itself, so a scene booting in the same tick already
  // sees the new instant.
  const now = useRef(composeDate(initialDay, INITIAL_MINUTES));
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  const set = useCallback((nextDay: Date, nextMinutes: number) => {
    setDay(nextDay);
    setMinutes(nextMinutes);
    const next = composeDate(nextDay, nextMinutes);
    now.current = next;
    const state = applyRef.current(next);
    if (state) {
      setSun(state);
    }
  }, []);
  const setInstant = useCallback(
    (instant: Date) => {
      const parts = splitDate(instant);
      set(parts.day, parts.minutes);
    },
    [set]
  );
  const sync = useCallback(() => {
    const state = applyRef.current(now.current);
    if (state) {
      setSun(state);
    }
  }, []);
  const current = useCallback(() => now.current, []);
  return { day, minutes, date, sun, set, setInstant, sync, current };
}
