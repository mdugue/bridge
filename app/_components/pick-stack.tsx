"use client";

import { LayersIcon, ScanEyeIcon, XIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { cn } from "cn";
import { cardCredits } from "@/lib/city/card-lines";
import { type Inquiry, inquiryCard } from "@/lib/city/inquiry";
import { useSite } from "./site-context";

/** The most cards that peek out behind the open one; more still count. */
const PEEKS = 4;
/** How far each card behind peeks out above the one in front (px). */
const PEEK_PX = 26;
/** Each card behind turns a little, alternating, as a stack in a hand. */
const TILT_DEG = [-2.2, 1.8, -1.4, 2.6];

/**
 * The selection as a stack of cards: the open card in front, the other
 * picks behind it, each a little turned and peeking out above with its
 * number and title — a click brings one to the front, × takes it out.
 * Over the stack: *Mehrere* (every question adds, as Shift+click and
 * Shift+I do — the touch screen's way, which has no Shift) and, for
 * several picks, *Alle zeigen* (one view that holds them all).
 *
 * On a touch screen the sheet is the card; the others are small tilted
 * cards in a row above it.
 */
export function PickStack({
  active,
  adding,
  children,
  onActivate,
  onAdding,
  onRemove,
  onShowAll,
  overStrip = false,
  picks,
  sheet = false,
}: {
  active: number;
  adding: boolean;
  /** the open card (a desktop's stack is drawn round it) */
  children?: ReactNode;
  onActivate: (index: number) => void;
  onAdding: (on: boolean) => void;
  onRemove: (index: number) => void;
  onShowAll: () => void;
  /** a touch screen: the candidates' chips are below, so it sits above */
  overStrip?: boolean;
  picks: readonly Inquiry[];
  /** a touch screen: a row of small cards above the bottom sheet */
  sheet?: boolean;
}) {
  const site = useSite();
  const labels = useMemo(
    () => picks.map((p) => inquiryCard(p, null, cardCredits(site)).title),
    [picks, site]
  );
  const several = picks.length > 1;
  // the others, nearest the open one first
  const behind = picks
    .map((_, i) => i)
    .filter((i) => i !== active)
    .sort((a, b) => Math.abs(a - active) - Math.abs(b - active));
  const hidden = Math.max(0, behind.length - PEEKS);
  const tools = (
    <div className="pointer-events-auto flex items-center gap-1 text-[11px]">
      <button
        aria-pressed={adding}
        className="flex items-center gap-1 rounded-full bg-card/70 px-2.5 py-1 leading-none text-foreground/75 shadow-sm ring-1 ring-foreground/[0.06] backdrop-blur-md hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        onClick={() => onAdding(!adding)}
        title={
          sheet
            ? "Mehrere auswählen: jedes lange Drücken fügt hinzu"
            : "Mehrere auswählen: jeder Klick fügt hinzu (oder Shift+Klick)"
        }
        type="button"
      >
        <LayersIcon aria-hidden className="size-3.5" />
        Mehrere
      </button>
      {several && (
        <button
          className="flex items-center gap-1 rounded-full bg-card/70 px-2.5 py-1 leading-none text-foreground/75 shadow-sm ring-1 ring-foreground/[0.06] backdrop-blur-md hover:text-foreground"
          data-testid="pick-show-all"
          onClick={onShowAll}
          title="Eine Ansicht, die alle Ausgewählten zeigt"
          type="button"
        >
          <ScanEyeIcon aria-hidden className="size-3.5" />
          Alle zeigen
        </button>
      )}
      {several && (
        <span className="px-1 text-muted-foreground tabular-nums">
          {picks.length} ausgewählt
        </span>
      )}
      {!sheet && hidden > 0 && (
        // the picks beyond the peeking cards: a click brings the next
        // forward, so every pick stays a few clicks away
        <button
          className="rounded-full px-1 text-muted-foreground hover:text-foreground"
          onClick={() => onActivate(behind[PEEKS])}
          title={`${labels[behind[PEEKS]]} öffnen`}
          type="button"
        >
          + {hidden} weitere
        </button>
      )}
    </div>
  );
  const pickCard = (i: number, depth: number) => (
    <div
      className={cn(
        "group pointer-events-auto flex items-start gap-1.5 bg-card text-card-foreground shadow-md ring-1 ring-foreground/10 transition-transform duration-200 ease-out",
        sheet
          ? "h-9 shrink-0 items-center rounded-lg px-2 hover:-translate-y-0.5"
          : "absolute inset-x-2 top-0 h-24 rounded-lg px-3 pt-1.5 hover:-translate-y-1.5"
      )}
      data-testid="pick-card"
      // reason: a pick's place in the order is what it is called by
      key={`${i}:${labels[i]}`}
      style={
        sheet
          ? { rotate: `${TILT_DEG[depth % TILT_DEG.length]}deg` }
          : {
              translate: `0 ${-(depth + 1) * PEEK_PX}px`,
              rotate: `${TILT_DEG[depth % TILT_DEG.length]}deg`,
              zIndex: PEEKS - depth,
              // the farther back, the paler: a stack, not a list
              filter: `brightness(${1 - depth * 0.03})`,
            }
      }
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-[12px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onActivate(i)}
        title={`${labels[i]} öffnen`}
        type="button"
      >
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary tabular-nums">
          {i + 1}
        </span>
        <span className={cn("truncate", sheet && "max-w-[7rem]")}>
          {labels[i]}
        </span>
      </button>
      <button
        aria-label={`${labels[i]} abwählen`}
        className="shrink-0 rounded-full p-1 text-muted-foreground opacity-60 group-hover:opacity-100 hover:text-foreground"
        onClick={() => onRemove(i)}
        type="button"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
  if (sheet) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-1.5 px-3",
          overStrip
            ? "bottom-[calc(8.25rem+3.75rem)]"
            : "bottom-[calc(8.25rem+0.75rem)]"
        )}
        data-testid="pick-stack"
      >
        {several && (
          <div className="flex max-w-full gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
            {behind.map((i, depth) => pickCard(i, depth))}
          </div>
        )}
        {tools}
      </div>
    );
  }
  const shown = behind.slice(0, PEEKS);
  const peek = shown.length * PEEK_PX;
  return (
    <div
      className="pointer-events-none flex min-h-0 shrink flex-col gap-2"
      data-testid="pick-stack"
    >
      {tools}
      <div
        className="relative flex min-h-0 shrink flex-col"
        style={{ marginTop: peek }}
      >
        {shown.map((i, depth) => pickCard(i, depth))}
        {/* the open card in front, numbered like the rest */}
        <div className="relative z-10 flex min-h-0 shrink flex-col">
          {several && (
            <span className="pointer-events-none absolute -top-2 -left-2 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground tabular-nums shadow-sm">
              {active + 1}
            </span>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
