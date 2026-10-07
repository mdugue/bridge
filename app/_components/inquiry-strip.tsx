"use client";

import {
  AnchorIcon,
  ArmchairIcon,
  BikeIcon,
  BridgeIcon,
  Building2Icon,
  CarIcon,
  FerrisWheelIcon,
  LampFloorIcon,
  LandmarkIcon,
  type LucideIcon,
  ShrubIcon,
  TramFrontIcon,
  TreeDeciduousIcon,
  TreePineIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "cn";
import {
  type Inquiry,
  type InquiryAlong,
  inquiryCard,
} from "@/lib/city/inquiry";
import { cardCredits } from "@/lib/city/card-lines";
import { TOLERANCE_PX } from "./inquiry-probe";
import { useSite } from "./site-context";

/** The icon a candidate is drawn with. */
function kindIcon(inquiry: Inquiry): LucideIcon {
  switch (inquiry.kind) {
    case "building":
      return Building2Icon;
    case "tree":
      return inquiry.conifer ? TreePineIcon : TreeDeciduousIcon;
    case "monument":
      return LandmarkIcon;
    case "bridge":
      return BridgeIcon;
    case "traffic":
      return CarIcon;
    case "bikes":
      return BikeIcon;
    case "canopy":
      return TreeDeciduousIcon;
    case "hedge":
      return ShrubIcon;
    case "lamp":
      return LampFloorIcon;
    case "furniture":
      return PLAY.has(inquiry.properties.k) ? FerrisWheelIcon : ArmchairIcon;
    case "stop":
      return TramFrontIcon;
    case "landing":
      return AnchorIcon;
  }
}

const PLAY = new Set([
  "climb",
  "playground",
  "playhouse",
  "roundabout",
  "sandpit",
  "seesaw",
  "slide",
  "springy",
  "swing",
]);

const whole = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const tenths = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** "12 m", "1,4 km": how far the ray went to meet it. */
export function distanceLabel(m: number): string {
  return m < 1000 ? `${whole.format(m)} m` : `${tenths.format(m / 1000)} km`;
}

/** A finger-wide ring at the tap, pulsed once: how far round the point
 *  the question looked (the crosshair's when asked by key: none). */
export function InquiryTapRing({ along }: { along: InquiryAlong }) {
  if (!along.at || along.candidates.length < 2) {
    return null;
  }
  const x = (along.at.x + 1) / 2;
  const y = (1 - along.at.y) / 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] [animation-fill-mode:forwards] [animation-iteration-count:1]"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: TOLERANCE_PX * 2,
        height: TOLERANCE_PX * 2,
      }}
    />
  );
}

/**
 * Everything the question's ray met, front to back (plan 052), apart from
 * the card so the card stays about one thing — the way an editor's
 * "select the layer under the pointer" list works. On a desktop a quiet
 * list in the card's column, under it: one row per candidate, the chosen
 * one marked; on a touch screen a row of chips above the folded sheet,
 * scrolled sideways. Glass, not paper: the scene shows through. The
 * pointer on a row outlines its thing in the scene for as long as it
 * stays, a click shows it in the card.
 */
export function InquiryStrip({
  along,
  onPreview,
  onSelect,
  sheet = false,
}: {
  along: InquiryAlong;
  onPreview: (index: number | null) => void;
  onSelect: (index: number) => void;
  /** a touch screen: chips above the bottom sheet, not a list */
  sheet?: boolean;
}) {
  const site = useSite();
  const items = useMemo(
    () =>
      along.candidates.map((c) => {
        const card = inquiryCard(c.inquiry, null, cardCredits(site));
        return {
          icon: kindIcon(c.inquiry),
          key: c.key,
          kicker: card.kicker,
          label: card.title,
          distance: distanceLabel(c.distance),
        };
      }),
    [along, site]
  );
  // the chips scroll sideways: the chosen one into view
  const chips = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = chips.current;
    const chosen = nav?.querySelector<HTMLElement>("[aria-current]");
    if (nav && chosen) {
      nav.scrollLeft =
        chosen.offsetLeft - (nav.clientWidth - chosen.offsetWidth) / 2;
    }
  }, [along]);
  if (items.length < 2) {
    return null;
  }
  const row = (item: (typeof items)[number], i: number) => {
    const Icon = item.icon;
    const chosen = i === along.selected;
    return (
      <button
        aria-current={chosen ? "true" : undefined}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md text-left leading-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          sheet ? "shrink-0 rounded-full px-2.5 py-1.5" : "w-full px-2 py-1.5",
          chosen
            ? "bg-foreground/[0.08] text-foreground"
            : "text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground"
        )}
        key={item.key}
        onBlur={() => onPreview(null)}
        onClick={() => onSelect(i)}
        onFocus={() => onPreview(i)}
        onPointerEnter={() => onPreview(i)}
        title={`${item.kicker} · ${item.distance}`}
        type="button"
      >
        <Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            chosen ? "text-foreground" : "text-muted-foreground"
          )}
        />
        <span
          className={cn(
            "truncate",
            sheet ? "max-w-[8rem]" : "flex-1",
            chosen && "font-medium"
          )}
        >
          {item.label}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {item.distance}
        </span>
      </button>
    );
  };
  const glass =
    "pointer-events-auto bg-card/65 text-card-foreground shadow-sm ring-1 ring-foreground/[0.06] backdrop-blur-md";
  if (sheet) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(8.25rem+0.75rem)] z-20 flex justify-center px-3">
        <nav
          aria-label="Was hier noch gemeint sein kann, vorn zuerst"
          className={cn(
            glass,
            "relative flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1 text-[12px] [scrollbar-width:none]"
          )}
          data-testid="inquiry-strip"
          ref={chips}
        >
          {items.map(row)}
        </nav>
      </div>
    );
  }
  return (
    <nav
      aria-label="Was hier noch gemeint sein kann, vorn zuerst"
      className={cn(
        glass,
        "flex max-h-[40%] min-h-0 shrink-0 flex-col rounded-lg p-1 text-[12px]"
      )}
      data-testid="inquiry-strip"
      onPointerLeave={() => onPreview(null)}
    >
      <p className="px-2 pt-1 pb-1 text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
        Hier auch · vorn zuerst
      </p>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {items.map(row)}
      </div>
    </nav>
  );
}
