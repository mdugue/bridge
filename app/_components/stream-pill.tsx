"use client";

import { useEffect, useState, ViewTransition } from "react";
import { cn } from "@/lib/utils";
import {
  type LoadStageState,
  stagesDoneLabel,
  streamingTitle,
} from "@/lib/city/load-stages";
import {
  HANDOVER_SHARE_SOLID,
  HANDOVER_SHARE_SURFACE,
  HANDOVER_STACK_NAME,
  HANDOVER_SURFACE_NAME,
  handoverSegmentName,
} from "./handover";

/**
 * "Erster Frame" — the loading screen at pill size, pinned to the top of the
 * live scene. Same six stages, same colours, same order: the stack became the
 * glyph, each swatch became a segment, and the layers that are still streaming
 * keep filling them while you walk around.
 *
 * The text and the counter arrive last by a plain CSS animation rather than a
 * `<ViewTransition enter>`: they sit inside the pill, and a nested boundary
 * that mounts together with its parent never fires its own enter. The CSS runs
 * either way, which is also what the no-view-transitions path needs.
 */

/** The two ends of a segment, as the HUD's own foreground token. */
const FILLED = "var(--hud-foreground)";
const EMPTY = "rgb(255 255 255 / 0.18)";

/**
 * A warm cache finishes the remaining layers in well under a second, and a
 * progress bar that flashes past is worse than none: you see something move
 * at the top of the screen and never learn what it was. So the pill keeps the
 * floor below, and always ends on "Alles geladen" rather than vanishing
 * mid-sentence.
 */
const MIN_VISIBLE_MS = 2500;
/** How long "Alles geladen" stays after the last layer lands. */
const DONE_LINGER_MS = 1600;
const FADE_MS = 400;

/** The three bars the plate stack collapses into. */
function StackGlyph({ plates }: { plates: LoadStageState[] }) {
  // The glyph reads as "layers", not as a count — the top three plate colours
  // are enough, dimmed while their layer has not landed.
  const bars = plates.slice(0, 3);
  return (
    <ViewTransition
      default="none"
      name={HANDOVER_STACK_NAME}
      share={HANDOVER_SHARE_SOLID}
    >
      <span aria-hidden className="relative flex flex-col gap-0.5">
        {bars.map((stage) => (
          <span
            className="h-1.25 w-3 rounded-xs transition-opacity duration-500"
            key={stage.id}
            style={{ background: stage.color, opacity: stage.done ? 1 : 0.35 }}
          />
        ))}
      </span>
    </ViewTransition>
  );
}

/** One stage as a segment: filled when done, part-filled while it streams. */
function Segment({ stage }: { stage: LoadStageState }) {
  const pct = Math.round(stage.fraction * 100);
  return (
    <ViewTransition
      default="none"
      name={handoverSegmentName(stage.id)}
      share={HANDOVER_SHARE_SOLID}
    >
      <span
        className="h-1 w-5.5 rounded-full"
        style={{
          background: stage.done
            ? FILLED
            : stage.active
              ? `linear-gradient(90deg,${FILLED} ${pct}%,${EMPTY} ${pct}%)`
              : EMPTY,
        }}
      />
    </ViewTransition>
  );
}

export function StreamPill({ stages }: { stages: LoadStageState[] }) {
  const allDone = stages.every((stage) => stage.done);
  const [mountedAt] = useState(() => Date.now());
  const [phase, setPhase] = useState<"gone" | "leaving" | "shown">("shown");

  // Nothing to report any more: hold the finished state briefly, and never
  // for less than the floor, then leave.
  useEffect(() => {
    if (!allDone || phase !== "shown") {
      return;
    }
    const wait = Math.max(
      DONE_LINGER_MS,
      MIN_VISIBLE_MS - (Date.now() - mountedAt)
    );
    const timer = setTimeout(() => setPhase("leaving"), wait);
    return () => clearTimeout(timer);
  }, [allDone, phase, mountedAt]);

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
  return (
    <div
      className={cn(
        "hud-pill pointer-events-none absolute top-4 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-3 rounded-full pr-3.5 pl-3 text-hud-foreground transition-opacity duration-400",
        phase === "leaving" && "opacity-0"
      )}
    >
      {/* The surface the full-bleed loading screen shrank into. Separate from
          the content so the content can arrive on top of it. */}
      <ViewTransition
        default="none"
        name={HANDOVER_SURFACE_NAME}
        share={HANDOVER_SHARE_SURFACE}
      >
        <span className="absolute inset-0 rounded-full bg-hud/85 shadow-lg backdrop-blur-lg" />
      </ViewTransition>

      <StackGlyph plates={stages.filter((stage) => stage.plate)} />
      {/* Only the stage name is announced: the segments carry no text and the
          counter beside them would otherwise repeat it. */}
      <output
        aria-live="polite"
        className="hud-pill-text relative font-medium text-xs leading-none"
      >
        {streamingTitle(stages)}
      </output>
      <span className="relative flex gap-0.75">
        {stages.map((stage) => (
          <Segment key={stage.id} stage={stage} />
        ))}
      </span>
      <span className="hud-pill-text relative font-mono text-[11px] leading-none tabular-nums opacity-65">
        {stagesDoneLabel(stages)}
      </span>
    </div>
  );
}
