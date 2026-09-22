"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";

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
  { key: "Shift", action: "sprinten" },
  { key: "Space", action: "hoch (Flug)" },
  { key: "Scroll", action: "zoomen" },
  { key: "R", action: "abreißen" },
  { key: "B", action: "einsetzen" },
  { key: "Esc", action: "immersiv beenden" },
];

/** The touch equivalents, for coarse pointers. */
export const TOUCH_HINTS: readonly ControlHint[] = [
  { key: "Ziehen", action: "umsehen", primary: true },
  { key: "Joystick", action: "gehen", primary: true },
  { key: "2× Tippen", action: "hingehen", primary: true },
  { key: "2 Finger", action: "zoomen" },
];

const DISMISSED_KEY = "city-walk:hints-dismissed";

/** Whether the player has already waved the hints away, on any earlier visit. */
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Private mode / blocked storage: show the hints, which is the safe default.
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
 * The floating hint bar: bottom centre, over the scene, and gone for good once
 * dismissed. It wraps rather than scrolls — on a phone four hints do not fit
 * one line, and a line cut mid-word is worse than two lines. Everything it
 * says also lives in the sidebar under Steuerung, so dismissing loses nothing.
 */
export function ControlHintBar({ coarse }: { coarse: boolean }) {
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (dismissed) {
    return null;
  }
  // The bar is the welcome, not the manual: only the primary hints, and on a
  // touch device that is three short ones.
  const hints = (coarse ? TOUCH_HINTS : CONTROL_HINTS).filter(
    (hint) => hint.primary
  );
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-5 z-10 flex justify-center">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-3xl bg-hud/85 py-2 pr-2 pl-3.5 text-[11px] text-hud-foreground backdrop-blur-lg sm:text-xs">
        {/* The hints wrap; the dismiss stays beside them, never below. */}
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
          aria-label="Steuerungshinweise ausblenden"
          className="-mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-hud-foreground/70 hover:bg-white/15 hover:text-hud-foreground"
          onClick={() => {
            setDismissed(true);
            rememberDismissed();
          }}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
