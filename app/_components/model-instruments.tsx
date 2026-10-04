"use client";

import { RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { northArrowDeg, scaleBarFor, scaleLabel } from "@/lib/city/model-view";
import type { ModelHud } from "./model-rig";

/** The eight winds, for what the north arrow's button says. */
const WINDS = [
  "Norden",
  "Nordosten",
  "Osten",
  "Südosten",
  "Süden",
  "Südwesten",
  "Westen",
  "Nordwesten",
] as const;

export function windOf(turnDeg: number): string {
  const i = Math.round((((turnDeg % 360) + 360) % 360) / 45) % 8;
  return WINDS[i];
}

/** CSS px the scale bar may take at most. */
const BAR_MAX_PX = 150;

/**
 * The scale bar: a round length in alternating black and white segments,
 * labelled at 0, half and the end — HUD legend on the HUD's glass, never in
 * the scene (ADR 0042). It measures every length parallel to the picture
 * plane: the picture's horizontal in every view, and the whole plane in a
 * Lageplan, a Militärperspektive (the ground) and an Ansicht.
 */
export function ScaleBar({
  metresPerPixel,
  scale,
}: {
  metresPerPixel: number;
  scale: number;
}) {
  const bar = scaleBarFor(metresPerPixel, BAR_MAX_PX);
  const w = bar.px;
  const quarter = w / 4;
  return (
    <figure
      aria-label={`Maßstabsleiste: ${bar.labels[2]}, ${scaleLabel(scale)}`}
      className="m-0 flex flex-col gap-1 rounded-xl border border-white/30 bg-black/25 px-3 pt-1.5 pb-2 text-white backdrop-blur-sm"
      data-testid="scale-bar"
    >
      <svg
        aria-hidden
        className="overflow-visible"
        height={22}
        viewBox={`0 0 ${w} 22`}
        width={w}
      >
        <g fontSize={10} fill="currentColor">
          <text x={0} y={9}>
            {bar.labels[0]}
          </text>
          <text textAnchor="middle" x={w / 2} y={9}>
            {bar.labels[1]}
          </text>
          <text textAnchor="end" x={w} y={9}>
            {bar.labels[2]}
          </text>
        </g>
        <g stroke="white" strokeWidth={1}>
          <rect fill="white" height={6} width={quarter} x={0.5} y={14.5} />
          <rect
            fill="black"
            height={6}
            width={quarter}
            x={quarter + 0.5}
            y={14.5}
          />
          <rect
            fill="white"
            height={6}
            width={w / 2 - 1}
            x={w / 2 + 0.5}
            y={14.5}
          />
        </g>
      </svg>
      <figcaption className="font-mono text-[10px] text-white/75 leading-none tabular-nums">
        {scaleLabel(scale)}
        <span className="text-white/55"> · bei 96 dpi</span>
      </figcaption>
    </figure>
  );
}

/**
 * Modell's instruments, bottom left where the joystick stands on foot: the
 * north arrow between the two rotate buttons (a click on it turns north
 * up), and the scale bar above them.
 */
export function ModelInstruments({
  onNorth,
  onTurn,
  view,
}: {
  onNorth: () => void;
  onTurn: (deg: number) => void;
  view: ModelHud;
}) {
  const arrow = northArrowDeg(view);
  const button =
    "flex size-10 items-center justify-center rounded-full hover:bg-white/10";
  return (
    <div className="flex flex-col items-start gap-2.5">
      <ScaleBar metresPerPixel={view.metresPerPixel} scale={view.scale} />
      <fieldset
        aria-label="Ausrichtung"
        className="m-0 flex items-center gap-0.5 rounded-full border border-white/30 bg-black/25 p-1 text-white/85 backdrop-blur-sm"
      >
        <button
          aria-label="Nach links drehen"
          className={button}
          onClick={() => onTurn(-90)}
          title="Um 90° nach links drehen (Q)"
          type="button"
        >
          <RotateCcwIcon className="size-4" />
        </button>
        <button
          aria-label={`Norden nach oben — Blick nach ${windOf(view.turnDeg)}`}
          className="relative flex size-12 items-center justify-center rounded-full bg-black/25 hover:bg-white/10"
          data-testid="north-arrow"
          onClick={onNorth}
          title="Norden nach oben"
          type="button"
        >
          <svg
            aria-hidden
            className="transition-transform duration-150"
            height={36}
            style={{ transform: `rotate(${arrow}deg)` }}
            viewBox="-18 -18 36 36"
            width={36}
          >
            <path d="M0,-13 L5,2 L0,-1 L-5,2Z" fill="#ff6b5e" />
            <path d="M0,13 L5,2 L0,-1 L-5,2Z" fill="white" opacity={0.5} />
            <text
              fill="white"
              fontSize={8}
              fontWeight={600}
              textAnchor="middle"
              y={-14.5}
            >
              N
            </text>
          </svg>
        </button>
        <button
          aria-label="Nach rechts drehen"
          className={button}
          onClick={() => onTurn(90)}
          title="Um 90° nach rechts drehen (E)"
          type="button"
        >
          <RotateCwIcon className="size-4" />
        </button>
      </fieldset>
    </div>
  );
}
