"use client";

import {
  type LoadStageState,
  loadHeadline,
  WALKABLE_PERCENT,
} from "@/lib/city/load-stages";
import { cn } from "@/lib/utils";

/**
 * "Laden" — the full-bleed screen shown until the primary tile is walkable.
 *
 * Three things carry the load: a stack of plates, one per data layer, that
 * settles as its layer arrives; the stage list with each layer's own progress;
 * and a hairline bar whose tick marks where the scene becomes walkable. All
 * three read the same stage states the streaming pill reads.
 *
 * The surface is frosted glass, not a curtain: translucent over the canvas and
 * blurring whatever is behind it. For most of the load that is the opaque
 * scrim of the shell, so it reads as a plain dark screen; once the first frame
 * is drawn, the city itself appears through it. It is then removed in a single
 * frame, with nothing animating in between — see handover.ts for why.
 */

/** The isometric the stack is drawn in; the shadow plate shares it. */
const PLATE_TRANSFORM = "rotateX(60deg) rotateZ(45deg)";

function PlateStack({ plates }: { plates: LoadStageState[] }) {
  return (
    <div aria-hidden className="relative hidden size-105 shrink-0 lg:block">
      <div
        className="absolute top-45 left-20 size-65 rounded-lg bg-black/45 blur-lg"
        style={{ transform: `${PLATE_TRANSFORM} translate(30px,30px)` }}
      />
      <div className="absolute inset-0">
        {/* Painted back to front: the layer that landed first sits lowest. */}
        {plates
          .map((stage, i) => {
            // An unfinished layer hovers above its resting place and settles
            // as it loads — the plate IS that layer's progress bar.
            const hover = stage.active ? (1 - stage.fraction) * 90 : 0;
            const lift = -i * 26 - hover;
            return (
              <div
                className="absolute top-45 left-20 size-65 rounded-lg border transition-[transform,opacity,background-color] duration-500"
                key={stage.id}
                style={{
                  transform: `${PLATE_TRANSFORM} translate(${lift}px,${lift}px)`,
                  opacity: stage.done
                    ? 1
                    : stage.active
                      ? 0.35 + 0.55 * stage.fraction
                      : 0.1,
                  background: stage.pending ? "transparent" : stage.color,
                  borderStyle: stage.pending ? "dashed" : "solid",
                  borderColor: stage.done
                    ? "rgb(0 0 0 / 0.08)"
                    : "rgb(255 255 255 / 0.5)",
                }}
              />
            );
          })
          .reverse()}
      </div>
    </div>
  );
}

function StageRow({ stage }: { stage: LoadStageState }) {
  return (
    <div
      className="grid min-h-12 grid-cols-[18px_1fr_auto] items-center gap-3.5 border-white/10 border-b py-2 transition-opacity duration-500"
      style={{ opacity: stage.pending ? 0.4 : 1 }}
    >
      <span
        className="size-3.5 rotate-45 scale-80 rounded-xs border"
        style={{
          background: stage.pending ? "transparent" : stage.color,
          borderStyle: stage.pending ? "dashed" : "solid",
          borderColor: stage.pending ? "rgb(255 255 255 / 0.6)" : "transparent",
        }}
      />
      <span className="flex flex-col gap-1">
        <span className="font-medium text-sm leading-none">{stage.label}</span>
        <span className="font-mono text-[11px] leading-none opacity-55">
          {stage.meta}
        </span>
      </span>
      <span className="min-w-18 text-right font-medium font-mono text-[11px] tabular-nums opacity-85">
        {stage.stateText}
      </span>
    </div>
  );
}

export function LoadScreen({
  handedOver,
  percent,
  stages,
}: {
  /**
   * The first frame is up and the scene is live behind the glass: stop taking
   * pointer events, so the player can look around while the veil is still
   * there, and stop offering the screen to assistive tech.
   */
  handedOver: boolean;
  percent: number;
  stages: LoadStageState[];
}) {
  const plates = stages.filter((stage) => stage.plate);
  const walkable = percent >= WALKABLE_PERCENT;
  return (
    <div
      aria-hidden={handedOver}
      className={cn(
        "absolute inset-0 z-30",
        // Once the city is behind the glass the screen is a still image: the
        // plates, the rows and the bar stop mid-settle rather than animating
        // through the scene's first frames, which is exactly the competition
        // the handover was redesigned to remove.
        handedOver && "pointer-events-none **:transition-none"
      )}
    >
      {/* Frosted, not opaque: the canvas below shows through as soon as it has
          anything to show. `backdrop-filter` is a compositor pass, so this
          costs the main thread nothing while the scene boots. */}
      <div className="absolute inset-0 bg-[image:var(--hud-veil)] backdrop-blur-md" />

      <div className="absolute inset-0 flex flex-col px-8 py-10 text-hud-foreground sm:px-12 lg:px-18 lg:py-16">
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-[11px] uppercase leading-none tracking-widest opacity-60">
            City Walk
          </span>
          <span className="font-semibold text-lg leading-tight sm:text-xl">
            Dresden · Altstadt
          </span>
        </div>

        <div className="flex flex-1 items-center gap-10 xl:gap-20">
          <PlateStack plates={plates} />
          <div className="flex w-full max-w-140 flex-col gap-6">
            <div className="flex flex-col gap-2">
              {/* The one live region: the headline changes six times in a
                    load, while the percent below it changes once per chunk —
                    announcing the whole screen would talk over everything. */}
              <output
                aria-live="polite"
                className="block text-pretty font-medium text-2xl leading-tight tracking-tight sm:text-3xl"
              >
                {loadHeadline(stages)}
              </output>
              <p className="text-sm leading-relaxed opacity-65">
                Die erste Kachel zuerst — sobald Gelände, Gebäude und Licht
                stehen, kannst du losgehen. Der Rest kommt im Hintergrund dazu.
              </p>
            </div>
            <div className="flex flex-col">
              {stages.map((stage) => (
                <div key={stage.id}>
                  {stage.showsDividerBefore && (
                    <div className="flex justify-end py-1.5">
                      <span className="font-medium text-[10px] uppercase leading-none tracking-widest opacity-45">
                        ab hier begehbar
                      </span>
                    </div>
                  )}
                  <StageRow stage={stage} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex justify-between text-[11px] leading-none opacity-60">
            <span>
              {walkable ? "Begehbar · Rest streamt" : "Bis zum ersten Bild"}
            </span>
            <span className="font-mono tabular-nums">
              {Math.round(percent)} %
            </span>
          </div>
          <div className="relative h-0.5 bg-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-hud-foreground transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
            <div
              className="-top-1 absolute h-2.5 w-px bg-white/50"
              style={{ left: `${WALKABLE_PERCENT}%` }}
            />
            <span
              className="absolute top-2.5 -translate-x-1/2 whitespace-nowrap font-medium text-[10px] uppercase leading-none tracking-widest opacity-55"
              style={{ left: `${WALKABLE_PERCENT}%` }}
            >
              begehbar
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
