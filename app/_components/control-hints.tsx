"use client";

/**
 * How you move, declared once. The floating bar below the scene shows the four
 * you need in the first ten seconds; the sidebar's Steuerung table shows all of
 * them. Same source, so the two can never drift apart.
 */
export interface ControlHint {
  action: string;
  /** shown in the floating bar as well as the sidebar table */
  primary?: boolean;
  key: string;
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
  { key: "Zwei Finger", action: "zoomen", primary: true },
];

/**
 * The floating hint bar. It sits where the design puts it — bottom centre,
 * over the scene — and steps aside when the sidebar is open, which is where
 * the full table lives anyway.
 */
export function ControlHintBar({ coarse }: { coarse: boolean }) {
  const hints = (coarse ? TOUCH_HINTS : CONTROL_HINTS).filter(
    (hint) => hint.primary
  );
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 flex h-10 max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-4.5 overflow-hidden rounded-full bg-hud/85 px-4 text-hud-foreground text-xs backdrop-blur-lg">
      {hints.map((hint) => (
        <span className="flex items-center gap-1.5" key={hint.key}>
          <span className="inline-flex h-5 items-center whitespace-nowrap rounded-sm bg-white/15 px-1.5 font-medium text-[11px] leading-none">
            {hint.key}
          </span>
          {hint.action}
        </span>
      ))}
    </div>
  );
}
