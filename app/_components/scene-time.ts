/**
 * The scene's instant as the HUD holds it: a calendar day and a
 * minutes-of-day slider, the sun state the scene answered with, and the one
 * way to change them — which also tells the scene. A remount boots the new
 * scene at the current instant, not at the page's first one.
 */
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

/**
 * The minute of day a glide of the hour shows at share `t` (0–1) of its
 * way: eased as the camera's glide is (smootherstep, camera-flight.ts),
 * so light and camera arrive together; whole minutes, as the slider.
 */
export function tweenMinutes(from: number, to: number, t: number): number {
  const k = Math.min(Math.max(t, 0), 1);
  const e = k * k * k * (k * (k * 6 - 15) + 10);
  return Math.round(from + (to - from) * e);
}

/** Whether the visitor asked for less motion: the hour then jumps. */
function reducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface FrameGate {
  /** runs now, or once the frame that already ran it is over */
  request: () => void;
  /** drops a run still waiting for its frame */
  cancel: () => void;
}

/**
 * Runs `run` at most once per animation frame: the first request of a
 * frame runs at once, the ones after it in the same frame collapse into
 * one run as the next frame starts (after that frame's render, which three
 * asked for first — so the scene trails a drag by a frame). A slider dragged by a
 * mouse that reports more often than the screen draws (or a touch) asks
 * many times a frame; the scene only needs the last.
 */
export function frameGate(
  run: () => void,
  schedule: (callback: () => void) => number = requestAnimationFrame,
  unschedule: (handle: number) => void = cancelAnimationFrame
): FrameGate {
  let frame: number | null = null;
  let waiting = false;
  const request = () => {
    if (frame !== null) {
      waiting = true;
      return;
    }
    run();
    frame = schedule(() => {
      frame = null;
      if (waiting) {
        waiting = false;
        request();
      }
    });
  };
  return {
    request,
    cancel: () => {
      if (frame !== null) {
        unschedule(frame);
      }
      frame = null;
      waiting = false;
    },
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
  /**
   * The same for every step of a drag: the scene follows at most once a
   * frame, and the rest of the HUD with it, as a transition behind the
   * frames — the slider shows its own value meanwhile. `set` ends a drag.
   */
  preview: (day: Date, minutes: number) => void;
  /** moves the scene to an instant (to the minute the sliders can show) */
  setInstant: (date: Date) => void;
  /**
   * Moves the scene to an instant over `seconds`: the day at once, the
   * hour gliding there (a walk's stop, while the camera flies to it). Any
   * other change of the time ends the glide where it is.
   */
  glideTo: (date: Date, seconds: number) => void;
  /** tells a (new) scene the current instant */
  sync: () => void;
  /** the current instant, for a scene that boots */
  current: () => Date;
}

/** `apply` hands an instant to the scene, which answers with its sun (or
 *  nothing while there is no scene); `preview` marks a drag's step. */
export function useSceneTime(
  apply: (date: Date, preview?: boolean) => SunState | undefined,
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

  // A drag's steps reach the scene through the gate, and the scene's answer
  // reaches the HUD as a transition: one sun a frame, no HUD render in one.
  const previewed = useRef({ day: initialDay, minutes: INITIAL_MINUTES });
  const toScene = useCallback(() => {
    const state = applyRef.current(now.current, true);
    const step = previewed.current;
    startTransition(() => {
      setDay(step.day);
      setMinutes(step.minutes);
      if (state) {
        setSun(state);
      }
    });
  }, []);
  const gate = useRef<FrameGate | null>(null);
  useEffect(() => {
    const own = frameGate(toScene);
    gate.current = own;
    return () => {
      own.cancel();
      gate.current = null;
    };
  }, [toScene]);

  // A glide of the hour: a step a frame through the drag's path (the
  // shadows and the sky refresh as in a drag), the last through `set`'s.
  const glide = useRef<number | null>(null);
  const endGlide = useCallback(() => {
    if (glide.current !== null) {
      cancelAnimationFrame(glide.current);
      glide.current = null;
    }
  }, []);
  useEffect(() => endGlide, [endGlide]);

  const setNow = useCallback((nextDay: Date, nextMinutes: number) => {
    gate.current?.cancel();
    setDay(nextDay);
    setMinutes(nextMinutes);
    const next = composeDate(nextDay, nextMinutes);
    now.current = next;
    const state = applyRef.current(next);
    if (state) {
      setSun(state);
    }
  }, []);
  const previewNow = useCallback(
    (nextDay: Date, nextMinutes: number) => {
      now.current = composeDate(nextDay, nextMinutes);
      previewed.current = { day: nextDay, minutes: nextMinutes };
      if (gate.current) {
        gate.current.request();
      } else {
        toScene();
      }
    },
    [toScene]
  );
  const set = useCallback(
    (nextDay: Date, nextMinutes: number) => {
      endGlide();
      setNow(nextDay, nextMinutes);
    },
    [endGlide, setNow]
  );
  const preview = useCallback(
    (nextDay: Date, nextMinutes: number) => {
      endGlide();
      previewNow(nextDay, nextMinutes);
    },
    [endGlide, previewNow]
  );
  const setInstant = useCallback(
    (instant: Date) => {
      const parts = splitDate(instant);
      set(parts.day, parts.minutes);
    },
    [set]
  );
  const glideTo = useCallback(
    (instant: Date, seconds: number) => {
      endGlide();
      const to = splitDate(instant);
      const from = splitDate(now.current);
      if (seconds <= 0 || from.minutes === to.minutes || reducedMotion()) {
        setNow(to.day, to.minutes);
        return;
      }
      let start: number | null = null;
      const step = (at: number) => {
        start ??= at;
        const t = (at - start) / (seconds * 1000);
        if (t >= 1) {
          glide.current = null;
          setNow(to.day, to.minutes);
          return;
        }
        previewNow(to.day, tweenMinutes(from.minutes, to.minutes, t));
        glide.current = requestAnimationFrame(step);
      };
      glide.current = requestAnimationFrame(step);
    },
    [endGlide, setNow, previewNow]
  );
  const sync = useCallback(() => {
    const state = applyRef.current(now.current);
    if (state) {
      setSun(state);
    }
  }, []);
  const current = useCallback(() => now.current, []);
  return {
    day,
    minutes,
    date,
    sun,
    set,
    preview,
    setInstant,
    glideTo,
    sync,
    current,
  };
}
