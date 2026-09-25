"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "cn";

/**
 * How you move, declared once. The floating bar over the scene shows the few
 * you need in the first ten seconds; the sidebar's Steuerung table shows all
 * of them. Same source, so the two can never drift apart.
 */
export interface ControlHint {
  action: string;
  key: string;
  /** shown in the floating bar as well as the sidebar table */
  primary?: boolean;
}

export const CONTROL_HINTS: readonly ControlHint[] = [
  { key: "Ziehen", action: "umsehen", primary: true },
  { key: "W A S D", action: "gehen", primary: true },
  { key: "F", action: "fliegen", primary: true },
  { key: "2× Klick", action: "hingehen", primary: true },
  { key: "Shift", action: "sprinten · runter (Flug)" },
  { key: "Space / E", action: "hoch (Flug)" },
  { key: "Q", action: "runter (Flug)" },
  { key: "1 – 9", action: "Aussichtspunkt" },
  { key: "Scroll", action: "zoomen" },
  { key: "R", action: "abreißen" },
  { key: "Esc", action: "immersiv beenden" },
];

/** The touch equivalents, for coarse pointers. */
export const TOUCH_HINTS: readonly ControlHint[] = [
  { key: "Ziehen", action: "umsehen", primary: true },
  { key: "Joystick", action: "gehen", primary: true },
  { key: "2× Tippen", action: "hingehen", primary: true },
  { key: "2 Finger", action: "zoomen" },
  { key: "✈ Knopf", action: "fliegen / gehen" },
  { key: "Höhenregler", action: "steigen / sinken (Flug)" },
];

const DISMISSED_KEY = "city-walk:hints-dismissed";
/** Long enough to read as a fade, short enough not to linger. */
const FADE_MS = 300;

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Private mode / blocked storage: show the hints, the safe default.
    return false;
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Nothing to do — they stay dismissed for this session either way.
  }
}

/**
 * The floating hint bar: bottom centre, over the scene, and gone when — and
 * only when — you say so. It does not time out and it does not read the
 * camera: moving around is not the same as being done reading, and a hint
 * that vanishes while you are still looking at it is worse than one that
 * waits. "Verstanden" is the one way out, a trailing action behind a hairline
 * divider (the snackbar convention), and it is remembered. Nothing is lost
 * either way: the full table lives in the sidebar under Steuerung.
 */
export function ControlHintBar({ coarse }: { coarse: boolean }) {
  const [phase, setPhase] = useState<"gone" | "leaving" | "shown">(() =>
    wasDismissed() ? "gone" : "shown"
  );
  const dismiss = useCallback(() => {
    setPhase((prev) => (prev === "shown" ? "leaving" : prev));
    rememberDismissed();
  }, []);

  // Unmount once the fade has played, not before.
  useEffect(() => {
    if (phase !== "leaving") {
      return;
    }
    const timer = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "gone") {
    return null;
  }
  // The bar is the welcome, not the manual: only the primary hints, and on a
  // touch device that is three short ones.
  const hints = (coarse ? TOUCH_HINTS : CONTROL_HINTS).filter(
    (hint) => hint.primary
  );
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-5 z-10 flex justify-center">
      <div
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-3 rounded-3xl bg-hud/85 py-2 pl-3.5 text-[11px] text-hud-foreground backdrop-blur-lg transition-opacity duration-300 sm:text-xs",
          phase === "leaving" && "opacity-0"
        )}
      >
        {/* The hints wrap; the action keeps the trailing edge, whatever they do. */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 sm:gap-x-4">
          {hints.map((hint) => (
            <span className="flex items-center gap-1.5" key={hint.key}>
              <span className="inline-flex h-5 items-center whitespace-nowrap rounded-sm bg-white/15 px-1.5 font-medium text-[10px] leading-none sm:text-[11px]">
                {hint.key}
              </span>
              {hint.action}
            </span>
          ))}
        </div>
        <button
          className="-my-2 shrink-0 self-stretch whitespace-nowrap rounded-r-3xl border-white/15 border-l px-3.5 font-medium text-hud-foreground/75 hover:bg-white/10 hover:text-hud-foreground"
          onClick={dismiss}
          type="button"
        >
          Verstanden
        </button>
      </div>
    </div>
  );
}
