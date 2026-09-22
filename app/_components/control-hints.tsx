"use client";

import { useCallback, useEffect, useState } from "react";
import { headingDelta, type PlayerPose } from "@/lib/city/pose";
import { cn } from "@/lib/utils";

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
/** How far you have to walk before the hints have plainly done their job (m). */
const MOVED_METRES = 3;
/** ...or how far you have to turn (rad ≈ 20°). */
const LOOKED_RADIANS = 0.35;
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
 * The floating hint bar: bottom centre, over the scene, and gone once you
 * have plainly got it.
 *
 * A coach mark is not a dialog, so it does not wait to be closed: the moment
 * you turn the camera or walk a few metres it has done its job and fades out
 * by itself. The explicit way out is a trailing "Verstanden" action — the
 * snackbar convention — rather than a bare ✕ floating next to a block of text
 * that wraps to two rows on a phone. Either way it is remembered, and nothing
 * is lost: the full table lives in the sidebar under Steuerung.
 */
export function ControlHintBar({
  coarse,
  subscribePose,
}: {
  coarse: boolean;
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
}) {
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

  // The camera itself says when the hints are spent.
  useEffect(() => {
    if (phase !== "shown") {
      return;
    }
    let start: PlayerPose | null = null;
    return subscribePose((pose) => {
      start ??= pose;
      const moved = Math.hypot(
        pose.epsgX - start.epsgX,
        pose.epsgY - start.epsgY
      );
      if (
        moved > MOVED_METRES ||
        headingDelta(pose.heading, start.heading) > LOOKED_RADIANS
      ) {
        dismiss();
      }
    });
  }, [phase, subscribePose, dismiss]);

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
