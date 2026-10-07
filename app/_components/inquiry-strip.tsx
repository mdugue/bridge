"use client";

import {
  BikeIcon,
  BridgeIcon,
  Building2Icon,
  CarIcon,
  ChevronRightIcon,
  LandmarkIcon,
  type LucideIcon,
  TreeDeciduousIcon,
  TreePineIcon,
} from "lucide-react";
import {
  type CSSProperties,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import {
  type Inquiry,
  type InquiryAlong,
  inquiryCard,
} from "@/lib/city/inquiry";
import { TOLERANCE_PX } from "./inquiry-probe";

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
  }
}

const whole = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const tenths = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** "12 m", "1,4 km": how far the ray went to meet it. */
export function distanceLabel(m: number): string {
  return m < 1000 ? `${whole.format(m)} m` : `${tenths.format(m / 1000)} km`;
}

/** The strip's left edge (px) that centres it on `share` of its parent's
 *  width, kept `margin` px inside it. */
function useClampedLeft(share: number, content: unknown, margin = 12) {
  const ref = useRef<HTMLElement | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!(el && parent)) {
      return;
    }
    const width = el.offsetWidth;
    const room = parent.clientWidth;
    const centred = share * room - width / 2;
    setLeft(Math.max(margin, Math.min(centred, room - margin - width)));
  }, [share, content, margin]);
  return [ref, left] as const;
}

/**
 * Everything the question's ray met, front to back (plan 052): a strip of
 * its own beside the tap, apart from the card, so the card stays about one
 * thing. The chosen one is filled; the pointer on another outlines it in
 * the scene for as long as it stays, a click shows it in the card. A ring
 * at the tap, a finger wide, says how far round the point the question
 * looked. On a touch screen the strip sits above the folded sheet.
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
  /** a touch screen: above the bottom sheet, not at the tap */
  sheet?: boolean;
}) {
  const items = useMemo(
    () =>
      along.candidates.map((c) => {
        const card = inquiryCard(c.inquiry, null);
        return {
          icon: kindIcon(c.inquiry),
          key: c.key,
          kicker: card.kicker,
          label: card.title,
          distance: distanceLabel(c.distance),
        };
      }),
    [along]
  );
  // where the question was asked, in % of the scene (the crosshair when
  // asked by key)
  const at = along.at ?? { x: 0, y: 0 };
  const tap = { x: (at.x + 1) / 2, y: (1 - at.y) / 2 };
  const [ref, left] = useClampedLeft(tap.x, along);
  // below the tap's ring, or above it in the lower part of the screen
  const below = tap.y < 0.72;
  const place: CSSProperties = {
    left: left ?? `${tap.x * 100}%`,
    top: below
      ? `calc(${tap.y * 100}% + ${TOLERANCE_PX + 10}px)`
      : `calc(${tap.y * 100}% - ${TOLERANCE_PX + 10}px - 2.25rem)`,
    // unmeasured, it waits out of sight for its width
    visibility: left === null ? "hidden" : undefined,
  };
  if (items.length < 2) {
    return null;
  }
  return (
    <>
      {along.at && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] [animation-fill-mode:forwards] [animation-iteration-count:1] animate-ping"
          style={{
            left: `${tap.x * 100}%`,
            top: `${tap.y * 100}%`,
            width: TOLERANCE_PX * 2,
            height: TOLERANCE_PX * 2,
          }}
        />
      )}
      <div
        className={cn(
          "pointer-events-none absolute z-20",
          sheet
            ? "inset-x-0 bottom-[calc(8.25rem+0.75rem)] flex justify-center px-3"
            : "inset-0"
        )}
      >
        <nav
          aria-label="Was auf dem Strahl liegt"
          className={cn(
            "pointer-events-auto flex max-w-[calc(100%-1.5rem)] items-center gap-0.5 overflow-x-auto rounded-full bg-card/95 p-1 text-card-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur-sm [scrollbar-width:none]",
            !sheet && "absolute"
          )}
          data-testid="inquiry-strip"
          onPointerLeave={() => onPreview(null)}
          ref={(el) => {
            ref.current = el;
          }}
          style={sheet ? undefined : place}
        >
          <span className="shrink-0 pr-1 pl-2 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            vorn
          </span>
          {items.map((item, i) => {
            const Icon = item.icon;
            const chosen = i === along.selected;
            return (
              <span className="flex shrink-0 items-center" key={item.key}>
                {i > 0 && (
                  <ChevronRightIcon
                    aria-hidden
                    className="size-3 text-muted-foreground/50"
                  />
                )}
                <button
                  aria-current={chosen ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-[12px] leading-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    chosen
                      ? "bg-foreground text-background"
                      : "text-foreground/85 hover:bg-muted hover:text-foreground"
                  )}
                  onBlur={() => onPreview(null)}
                  onClick={() => onSelect(i)}
                  onFocus={() => onPreview(i)}
                  onPointerEnter={() => onPreview(i)}
                  title={`${item.kicker} · ${item.distance}`}
                  type="button"
                >
                  <Icon aria-hidden className="size-3.5 shrink-0" />
                  <span className="max-w-[9.5rem] truncate">{item.label}</span>
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
                      chosen ? "text-background/60" : "text-muted-foreground"
                    )}
                  >
                    {item.distance}
                  </span>
                </button>
              </span>
            );
          })}
          <span className="shrink-0 pr-2 pl-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            hinten
          </span>
        </nav>
      </div>
    </>
  );
}
