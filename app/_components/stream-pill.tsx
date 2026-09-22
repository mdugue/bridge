"use client";

import { ViewTransition } from "react";
import {
  activeStage,
  type LoadStageState,
  stagesDoneLabel,
} from "@/lib/city/load-stages";
import {
  HANDOVER_ENTER,
  HANDOVER_SHARE,
  HANDOVER_STACK_NAME,
  HANDOVER_SURFACE_NAME,
  handoverSegmentName,
} from "./handover";

/**
 * "Erster Frame" — the loading screen at pill size, pinned to the top of the
 * live scene. Same six stages, same colours, same order: the stack became the
 * glyph, each swatch became a segment, and the layers that are still streaming
 * keep filling them while you walk around.
 */

/** The three bars the plate stack collapses into. */
function StackGlyph({ plates }: { plates: LoadStageState[] }) {
  // The glyph reads as "layers", not as a count — the top three plate colours
  // are enough, dimmed while their layer has not landed.
  const bars = plates.slice(0, 3);
  return (
    <ViewTransition
      default="none"
      name={HANDOVER_STACK_NAME}
      share={HANDOVER_SHARE}
    >
      <span aria-hidden className="flex flex-col gap-0.5">
        {bars.map((stage) => (
          <span
            className="h-1.25 w-3 rounded-xs transition-opacity duration-500"
            key={stage.id}
            style={{
              background: stage.color,
              opacity: stage.done ? 1 : 0.35,
            }}
          />
        ))}
      </span>
    </ViewTransition>
  );
}

/** The two ends of a segment, as the HUD's own foreground token. */
const FILLED = "var(--hud-foreground)";
const EMPTY = "rgb(255 255 255 / 0.18)";

/** One stage as a segment: filled when done, part-filled while it streams. */
function Segment({ stage }: { stage: LoadStageState }) {
  const pct = Math.round(stage.fraction * 100);
  return (
    <ViewTransition
      default="none"
      name={handoverSegmentName(stage.id)}
      share={HANDOVER_SHARE}
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
  const active = activeStage(stages);
  const title = active ? active.streaming : "Alles geladen";
  return (
    <div className="hud-pill pointer-events-none absolute top-4 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-3 rounded-full pr-3.5 pl-3 text-hud-foreground">
      {/* The surface the full-bleed loading screen shrank into. Separate from
          the content so the content can fade in on top of it. */}
      <ViewTransition
        default="none"
        name={HANDOVER_SURFACE_NAME}
        share={HANDOVER_SHARE}
      >
        <span className="absolute inset-0 rounded-full bg-hud/85 shadow-lg backdrop-blur-lg" />
      </ViewTransition>

      <StackGlyph plates={stages.filter((stage) => stage.plate)} />
      <ViewTransition default="none" enter={HANDOVER_ENTER}>
        {/* Only the stage name is announced: the segments carry no text and
            the counter beside them would otherwise repeat it. */}
        <output
          aria-live="polite"
          className="relative font-medium text-xs leading-none"
        >
          {title}
        </output>
      </ViewTransition>
      <span className="relative flex gap-0.75">
        {stages.map((stage) => (
          <Segment key={stage.id} stage={stage} />
        ))}
      </span>
      <ViewTransition default="none" enter={HANDOVER_ENTER}>
        <span className="relative font-mono text-[11px] leading-none tabular-nums opacity-65">
          {stagesDoneLabel(stages)}
        </span>
      </ViewTransition>
    </div>
  );
}
