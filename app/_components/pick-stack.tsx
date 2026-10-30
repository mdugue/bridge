"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersIcon,
  ScanEyeIcon,
  XIcon,
} from "lucide-react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useDragControls,
  useTransform,
} from "motion/react";
import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import { cardCredits } from "@/lib/city/card-lines";
import { type Inquiry, inquiryCard } from "@/lib/city/inquiry";
import { deckBehind, stepped, swipeStep } from "@/lib/city/pick-swipe";
import { isControlKey, isTextEntry } from "./keyboard-controls";
import { useSite } from "./site-context";

/** The most cards that peek out behind the open one; more still count. */
const PEEKS = 4;
/** How far each card behind peeks out above the one in front (px). */
const PEEK_PX = 26;
/** Each card behind turns a little, alternating, as a stack in a hand. */
const TILT_DEG = [-2.2, 1.8, -1.4, 2.6];
/** How a card settles: quick, with a little give. */
const SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;
/** How far a card leafed on flies off (px), how it turns with its pull
 *  (°), and how fast it goes. */
const FLY_PX = 420;
const FLY_DEG = 12;
const FLY_OUT = { duration: 0.18, ease: "easeIn" } as const;

/**
 * Whether a pointer pressed here means a control or, with a mouse, the
 * card's text (a fact's value, an id to copy) rather than the card.
 */
function grabsText(event: PointerEvent): boolean {
  const el = event.target as HTMLElement;
  return (
    el.closest(
      "button, a, input, textarea, select, [role=slider], [contenteditable]"
    ) !== null ||
    (event.pointerType === "mouse" && el.closest("dd, code, p") !== null)
  );
}

/**
 * A swipe across `children` leafs through the picks (−1 back, +1 on) —
 * the touch screen's sheet, which is drawn apart from the stack, in a
 * portal: React's pointer events still bubble here through it, the
 * browser's do not. It adds no box of its own (`display: contents`) and
 * stays in place whether it listens or not, so the sheet is never
 * mounted anew.
 */
export function PickSwipe({
  children,
  enabled,
  onStep,
}: {
  children: ReactNode;
  enabled: boolean;
  onStep: (step: -1 | 1) => void;
}) {
  const start = useRef<{ t: number; x: number; y: number } | null>(null);
  return (
    <div
      className="contents"
      onPointerCancel={() => {
        start.current = null;
      }}
      onPointerDown={(event) => {
        start.current =
          enabled && event.isPrimary
            ? { t: event.timeStamp, x: event.clientX, y: event.clientY }
            : null;
      }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        if (!from) {
          return;
        }
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        const seconds = Math.max((event.timeStamp - from.t) / 1000, 0.016);
        // a mostly sideways swipe; a scroll or pull of the sheet is not one
        if (Math.abs(dx) > Math.abs(dy) * 1.5) {
          const by = swipeStep(dx, dx / seconds);
          if (by !== 0) {
            onStep(by);
          }
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * The selection as a deck of cards: the open card in front, the next
 * picks behind it, each a little turned and peeking out above with its
 * number and title — a click brings one to the front, × takes it out. The
 * front card is leafed through: swiped or flicked aside (it flies off and
 * the next comes forward, round the deck), the arrows beside the count,
 * or ← and → while the deck has the focus.
 * Over the stack: *Mehrere* (every question adds, as Shift+click and
 * Shift+I do — the touch screen's way, which has no Shift) and, for
 * several picks, *Alle zeigen* (one view that holds them all).
 *
 * On a touch screen the sheet is the card (`PickSwipe` leafs it); the
 * others are small tilted cards in a row above it.
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
  const reduced = useReducedMotion() ?? false;
  const several = picks.length > 1;
  // the front card is one card throughout: a step flies it off to the
  // side it goes, and the next card's content comes in from the deck
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-FLY_DEG, FLY_DEG]);
  const drag = useDragControls();
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const opacity = useMotionValue(1);
  const [flying, setFlying] = useState(false);
  // where the deck stands now: a flight lands on what is there when it
  // lands, not on what was there when it took off
  const latest = useRef({ active, count: picks.length });
  const alive = useRef(true);
  useEffect(() => {
    latest.current = { active, count: picks.length };
  });
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );
  /** The front card comes in from the deck's top. */
  const enter = () => {
    x.jump(0);
    if (reduced) {
      opacity.jump(1);
      return;
    }
    y.jump(-PEEK_PX);
    scale.jump(0.97);
    opacity.jump(0.4);
    void animate(y, 0, SPRING);
    void animate(scale, 1, SPRING);
    void animate(opacity, 1, { duration: 0.15 });
  };
  const step = (by: -1 | 1) => {
    if (reduced) {
      onActivate(stepped(active, by, picks.length));
      return;
    }
    if (flying) {
      return;
    }
    setFlying(true);
    // a step on (to the left, as a swipe on goes) leaves to the left
    void Promise.all([
      animate(x, -by * FLY_PX, FLY_OUT),
      animate(opacity, 0, FLY_OUT),
    ]).then(() => {
      if (!alive.current) {
        return;
      }
      setFlying(false);
      const now = latest.current;
      const next = stepped(now.active, by, now.count);
      if (next === now.active) {
        // nothing to go to any more (the selection shrank): it comes back
        enter();
      } else {
        onActivate(next);
      }
    });
  };
  const pick = (i: number) => onActivate(i);
  // whichever way a pick came forward, it comes in from the deck's top
  const shownKey = `${active}:${labels[active]}`;
  const lastKey = useRef(shownKey);
  useEffect(() => {
    if (lastKey.current !== shownKey) {
      lastKey.current = shownKey;
      enter();
    }
  });
  const keys = (event: KeyboardEvent) => {
    const by =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (
      several &&
      by !== 0 &&
      !isTextEntry(event.target) &&
      !isControlKey(event.code, event.target)
    ) {
      event.preventDefault();
      // the arrows leaf the deck here, they do not also turn the camera
      event.stopPropagation();
      step(by);
    }
  };
  // the others, the next first: the deck goes round
  const behind = deckBehind(active, picks.length);
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
        <span className="flex items-center text-muted-foreground tabular-nums">
          <button
            aria-label="Vorige Auswahl"
            className="rounded-full p-1 hover:text-foreground"
            data-testid="pick-prev"
            onClick={() => step(-1)}
            type="button"
          >
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          </button>
          <span data-testid="pick-count">
            {active + 1} / {picks.length}
          </span>
          <button
            aria-label="Nächste Auswahl"
            className="rounded-full p-1 hover:text-foreground"
            data-testid="pick-next"
            onClick={() => step(1)}
            type="button"
          >
            <ChevronRightIcon aria-hidden className="size-3.5" />
          </button>
        </span>
      )}
      {!sheet && hidden > 0 && (
        // the picks beyond the peeking cards: a click brings the next
        // forward, so every pick stays a few clicks away
        <button
          className="rounded-full px-1 text-muted-foreground hover:text-foreground"
          onClick={() => pick(behind[PEEKS])}
          title={`${labels[behind[PEEKS]]} öffnen`}
          type="button"
        >
          + {hidden} weitere
        </button>
      )}
    </div>
  );
  const tilt = (depth: number) => TILT_DEG[depth % TILT_DEG.length];
  const pickCard = (i: number, depth: number) => (
    <motion.div
      animate={
        sheet
          ? { rotate: tilt(depth) }
          : {
              y: -(depth + 1) * PEEK_PX,
              rotate: tilt(depth),
              // the farther back, the paler: a stack, not a list
              filter: `brightness(${1 - depth * 0.03})`,
            }
      }
      className={cn(
        "group pointer-events-auto flex items-start gap-1.5 bg-card text-card-foreground shadow-md ring-1 ring-foreground/10",
        sheet
          ? "h-9 shrink-0 items-center rounded-lg px-2"
          : "absolute inset-x-2 top-0 h-24 rounded-lg px-3 pt-1.5"
      )}
      data-testid="pick-card"
      initial={false}
      // reason: a pick's place in the order is what it is called by
      key={`${i}:${labels[i]}`}
      style={sheet ? undefined : { zIndex: PEEKS - depth }}
      transition={reduced ? { duration: 0 } : SPRING}
      whileHover={sheet ? { y: -2 } : { y: -(depth + 1) * PEEK_PX - 6 }}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-[12px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => pick(i)}
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
    </motion.div>
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
        {/* the open card in front, numbered like the rest: pulled aside
            it turns, let go far or fast enough it flies off and the next
            comes forward from the deck */}
        <motion.div
          className={cn(
            "relative z-10 flex min-h-0 shrink flex-col",
            several && "touch-pan-y"
          )}
          data-testid="pick-front"
          drag={several && !flying ? "x" : false}
          dragControls={drag}
          dragDirectionLock
          dragListener={false}
          // let go, it springs back or flies on: ours to animate
          dragMomentum={false}
          onDragEnd={(_, info) => {
            const by = swipeStep(info.offset.x, info.velocity.x);
            if (by === 0) {
              void animate(x, 0, SPRING);
            } else {
              step(by);
            }
          }}
          onKeyDown={keys}
          onPointerDown={(event) => {
            // not from a control, nor from the text a mouse selects
            if (!grabsText(event)) {
              drag.start(event);
            }
          }}
          style={{ x, y, rotate, scale, opacity }}
        >
          {several && (
            <span className="pointer-events-none absolute -top-2 -left-2 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground tabular-nums shadow-sm">
              {active + 1}
            </span>
          )}
          {children}
        </motion.div>
      </div>
    </div>
  );
}
