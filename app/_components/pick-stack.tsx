"use client";

import { LayersIcon, XIcon } from "lucide-react";
import { useMemo } from "react";
import { cn } from "cn";
import { cardCredits } from "@/lib/city/card-lines";
import { type Inquiry, inquiryCard } from "@/lib/city/inquiry";
import { useSite } from "./site-context";

/**
 * The selection over the inquiry card: every pick numbered (the order
 * they were picked in, or the order *Frag die Stadt* named them), the
 * one whose card is open marked; a click opens another's card, × takes
 * one out. *Mehrere* makes every question add, as Shift+click and
 * Shift+I do — the touch screen's way, which has no Shift. With a
 * single pick only *Mehrere* shows.
 */
export function PickStack({
  active,
  adding,
  onActivate,
  onAdding,
  onRemove,
  overStrip = false,
  picks,
  sheet = false,
}: {
  active: number;
  adding: boolean;
  onActivate: (index: number) => void;
  onAdding: (on: boolean) => void;
  onRemove: (index: number) => void;
  /** a touch screen: the candidates' chips are below, so it sits above */
  overStrip?: boolean;
  picks: readonly Inquiry[];
  /** a touch screen: a row of chips above the bottom sheet */
  sheet?: boolean;
}) {
  const site = useSite();
  const labels = useMemo(
    () => picks.map((p) => inquiryCard(p, null, cardCredits(site)).title),
    [picks, site]
  );
  const glass =
    "pointer-events-auto bg-card/65 text-card-foreground shadow-sm ring-1 ring-foreground/[0.06] backdrop-blur-md";
  const several = picks.length > 1;
  const nav = (
    <nav
      aria-label="Auswahl"
      className={cn(
        glass,
        "flex max-w-full items-center gap-0.5 overflow-x-auto p-1 text-[12px] [scrollbar-width:none]",
        sheet ? "rounded-full" : "flex-wrap rounded-lg"
      )}
      data-testid="pick-stack"
    >
      {several &&
        labels.map((label, i) => (
          <span
            className={cn(
              "flex shrink-0 items-center rounded-full leading-none",
              i === active
                ? "bg-primary/10 text-foreground"
                : "text-foreground/75 hover:bg-foreground/[0.05]"
            )}
            // reason: a pick's place in the order is what it is called by
            key={`${i}:${label}`}
          >
            <button
              aria-current={i === active ? "true" : undefined}
              className="flex items-center gap-1.5 py-1.5 pr-1 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onActivate(i)}
              type="button"
            >
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <span
                className={cn(
                  "max-w-[9rem] truncate",
                  i === active && "font-medium"
                )}
              >
                {label}
              </span>
            </button>
            <button
              aria-label={`${label} abwählen`}
              className="rounded-full p-1 pr-2 text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(i)}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
      <button
        aria-pressed={adding}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 leading-none text-foreground/75 hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        )}
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
    </nav>
  );
  if (sheet) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3",
          overStrip
            ? "bottom-[calc(8.25rem+3.75rem)]"
            : "bottom-[calc(8.25rem+0.75rem)]"
        )}
      >
        {nav}
      </div>
    );
  }
  return nav;
}
