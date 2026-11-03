"use client";

import { cn } from "cn";
import {
  type LoadStageState,
  loadHeadline,
  WALKABLE_PERCENT,
} from "@/lib/city/load-stages";
import { type ReactNode, useId } from "react";
import { useSite } from "./site-context";

/**
 * "Laden" — the full-bleed screen shown until the spawn tile is walkable.
 *
 * It speaks the scene's own loading language (load-veil.ts): the city not
 * yet there is unfired clay drawn in contour lines, and magenta shows
 * progress. A magenta ring stands in the middle of the survey sheet and
 * widens with the load; inside it the clay takes on the city's colours.
 * It breathes as the scene's ring does. When the screen gives way, the
 * scene picks up exactly there: the city in colour around you, the ring
 * walking out over clay.
 *
 * The surface is frosted clay, not a curtain: translucent over the canvas
 * and blurring whatever is behind it. For most of the load that is the
 * opaque clay scrim of the shell; once the first frame is drawn, the city
 * itself appears through it. It is then removed in a single frame, with
 * nothing animating in between — see handover.ts for why.
 */

/** The survey sheet's frame: a 1000-unit square, cropped to the screen. */
const SHEET = 1000;
const CENTRE = SHEET / 2;
/** The ring's radius (sheet units) at 0 % and at 100 %. */
const RING_MIN = 70;
const RING_MAX = 430;
const ringRadius = (percent: number) =>
  RING_MIN +
  ((RING_MAX - RING_MIN) * Math.min(100, Math.max(0, percent))) / 100;

/** Contour lines: one smooth closed curve per level, deterministic. */
const CONTOURS: string[] = (() => {
  const harmonics = [
    { k: 2, a: 0.09, p: 0.7 },
    { k: 3, a: 0.06, p: 2.1 },
    { k: 5, a: 0.035, p: 4.0 },
    { k: 7, a: 0.02, p: 1.3 },
  ];
  const levels = 22;
  const steps = 96;
  return Array.from({ length: levels }, (_, level) => {
    const base = 40 + level * 34;
    // the terrain leans differently at each level, as a real slope does
    const twist = level * 0.11;
    const points = Array.from({ length: steps }, (_, i) => {
      const t = (i / steps) * Math.PI * 2;
      const wobble = harmonics.reduce(
        (sum, h) => sum + h.a * Math.sin(h.k * t + h.p + twist * h.k * 0.5),
        0
      );
      const r = base * (1 + wobble);
      return `${(CENTRE + r * Math.cos(t)).toFixed(1)},${(CENTRE + r * Math.sin(t) * 0.82).toFixed(1)}`;
    });
    return `M${points.join("L")}Z`;
  });
})();

/** Where the ring stands on the walkable mark (sheet units). */
const WALKABLE_RADIUS = ringRadius(WALKABLE_PERCENT);

/** One layer of the survey sheet: the sheet's frame, cropped to the screen. */
function Sheet({
  breathes = false,
  children,
  multiply = false,
}: {
  breathes?: boolean;
  children: ReactNode;
  multiply?: boolean;
}) {
  return (
    <svg
      aria-hidden
      // A breathing layer scales as one element, which the compositor does
      // without a repaint (an SVG child's transform repaints the sheet).
      className={cn(
        "absolute inset-0 h-full w-full",
        breathes && "load-breathe",
        multiply && "mix-blend-multiply"
      )}
      preserveAspectRatio="xMidYMid slice"
      viewBox={`0 0 ${SHEET} ${SHEET}`}
    >
      {children}
    </svg>
  );
}

function SurveySheet({ percent }: { percent: number }) {
  const r = ringRadius(percent);
  // ids are document-wide: two screens mounted at once must not share them
  const colourId = `${useId()}-colour`;
  // the ring's radius moves with the load, not with every frame
  const grows = "transition-[r] duration-700 ease-out";
  return (
    <>
      {/* the survey: contours and the walkable mark, still */}
      <Sheet>
        <g fill="none" stroke="var(--load-line)" strokeWidth={1}>
          {CONTOURS.map((d, i) => (
            <path
              d={d}
              key={d}
              strokeOpacity={i % 5 === 4 ? 0.7 : 0.32}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        {/* the walkable mark: a dashed circle the ring has to reach */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          fill="none"
          r={WALKABLE_RADIUS}
          stroke="var(--load-ink)"
          strokeDasharray="2 6"
          strokeOpacity={0.55}
          vectorEffect="non-scaling-stroke"
        />
        <text
          fill="var(--load-ink)"
          fontSize={13}
          fontWeight={600}
          letterSpacing={3}
          textAnchor="middle"
          x={CENTRE}
          y={CENTRE - WALKABLE_RADIUS - 8}
        >
          BEGEHBAR
        </text>
      </Sheet>
      {/* over it, one layer that breathes: inside the ring the clay takes
          on colour (translucent, as the veil is: the first frame must show
          through), then the ring. Multiplied, so the survey's lines show
          through the colour as ink would. */}
      <Sheet breathes multiply>
        <defs>
          {/* the city's warm clay to its green edge, across the sheet */}
          <radialGradient
            cx={CENTRE}
            cy={CENTRE}
            gradientUnits="userSpaceOnUse"
            id={colourId}
            r={CENTRE}
          >
            <stop offset="0%" stopColor="#f3dcc0" />
            <stop offset="55%" stopColor="#e6dcc6" />
            <stop offset="100%" stopColor="#c7d4b0" />
          </radialGradient>
        </defs>
        <circle
          className={grows}
          cx={CENTRE}
          cy={CENTRE}
          fill={`url(#${colourId})`}
          fillOpacity={0.6}
          r={r}
        />
        {/* the ring: its halo soaking outward, then the line */}
        <circle
          className={grows}
          cx={CENTRE}
          cy={CENTRE}
          fill="none"
          r={r + 6}
          stroke="var(--load-ink)"
          strokeOpacity={0.18}
          strokeWidth={14}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          className={grows}
          cx={CENTRE}
          cy={CENTRE}
          fill="none"
          r={r}
          stroke="var(--load-ink)"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      </Sheet>
    </>
  );
}

/** One stage: its name, and a magenta line that fills as it loads. */
function StageMark({ stage }: { stage: LoadStageState }) {
  const pct = Math.round(stage.fraction * 100);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2 transition-opacity duration-500",
        stage.pending && "opacity-45"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium text-xs leading-none">
          {stage.label}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums leading-none opacity-60">
          {stage.stateText}
        </span>
      </div>
      <div className="relative h-0.5 overflow-hidden rounded-full bg-[var(--load-line)]/40">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--load-ink)] transition-[width] duration-500 ease-out"
          style={{ width: `${stage.done ? 100 : pct}%` }}
        />
      </div>
      <span className="hidden truncate font-mono text-[10px] leading-none opacity-50 xl:block">
        {stage.meta}
      </span>
    </div>
  );
}

export function LoadScreen({
  besidePanel = false,
  destination,
  handedOver,
  percent,
  stages,
}: {
  /** the side panel is open over the screen's right edge (a desktop) */
  besidePanel?: boolean;
  /** a place picked while loading: the scene starts there */
  destination?: string;
  /**
   * The first frame is up and the scene is live behind the glass: stop taking
   * pointer events, so the player can look around while the veil is still
   * there, and stop offering the screen to assistive tech.
   */
  handedOver: boolean;
  percent: number;
  stages: LoadStageState[];
}) {
  const site = useSite();
  const walkable = percent >= WALKABLE_PERCENT;
  return (
    <div
      aria-hidden={handedOver}
      className={cn(
        "absolute inset-0 z-30 text-[var(--load-text)]",
        // Once the city is behind the glass the screen is a still image:
        // nothing animates through the scene's first frames, which is
        // exactly the competition the handover was redesigned to remove.
        // Paused, not removed: the ring holds the breath it was at.
        handedOver &&
          "pointer-events-none **:transition-none **:[animation-play-state:paused]"
      )}
    >
      {/* Frosted, not opaque: the canvas below shows through as soon as it has
          anything to show. `backdrop-filter` is a compositor pass, so this
          costs the main thread nothing while the scene boots. */}
      <div className="absolute inset-0 bg-[image:var(--load-veil)] backdrop-blur-md" />

      <div
        className="absolute inset-0"
        // (inline: the sidebar width is a runtime CSS variable)
        style={
          besidePanel
            ? { right: "calc(var(--sidebar-width) + 1rem)" }
            : undefined
        }
      >
        <SurveySheet percent={percent} />

        <div className="absolute inset-0 flex flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-[11px] uppercase leading-none tracking-[0.25em] text-[var(--load-ink)]">
              City Walk
            </span>
            <span className="font-semibold text-2xl leading-tight tracking-tight sm:text-3xl">
              {site.label}
            </span>
            {destination && (
              <span className="text-sm leading-tight opacity-75">
                Start: {destination}
              </span>
            )}
          </div>

          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="font-mono font-semibold text-5xl tabular-nums leading-none tracking-tight sm:text-6xl">
              {Math.round(percent)}
              <span className="text-[0.5em] opacity-60"> %</span>
            </span>
            {/* The one live region: the headline changes six times in a
                load, while the percent changes once per chunk — announcing
                the whole screen would talk over everything. */}
            <output
              aria-live="polite"
              className="block max-w-72 text-balance font-medium text-base leading-snug"
            >
              {loadHeadline(stages)}
            </output>
            <span className="font-medium text-[10px] uppercase leading-none tracking-[0.2em] opacity-60">
              {walkable ? "Begehbar · Rest streamt" : "Bis zum ersten Bild"}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <p className="max-w-120 text-xs leading-relaxed opacity-70">
              Die Stadt färbt sich von dir aus ein. Sobald Gebäude, Gelände und
              Licht stehen, kannst du losgehen — der magentafarbene Ring zeigt
              dann im Bild, wie weit sie schon fertig ist.
            </p>
            <div className="flex gap-3 sm:gap-5">
              {stages.map((stage, i) => (
                <div
                  className={cn(
                    "flex min-w-0 flex-1 gap-3 sm:gap-5",
                    // a phone keeps the stages up to the first frame
                    i >= 3 && "max-sm:hidden"
                  )}
                  key={stage.id}
                >
                  {stage.showsDividerBefore && (
                    <span
                      className="w-px shrink-0 self-stretch bg-[var(--load-ink)]"
                      title="ab hier begehbar"
                    />
                  )}
                  <StageMark stage={stage} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
