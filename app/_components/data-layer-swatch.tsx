import type { CSSProperties } from "react";
import { BIKE_DIRECTION_TINTS, tintCss } from "@/lib/city/bike-counts";
import type { DataLayerKey } from "@/lib/city/data-layers";
import { TRAFFIC_TINTS } from "@/lib/city/traffic";
import { TRAM_TINTS } from "@/lib/city/tram-timetable";
import { cn } from "cn";

/**
 * The bridge from a data layer's switch to what it draws: a tiny moving
 * sample of it in the scene's own colours (the same constants the layers
 * use) — a glass flow with light running through it, two glass columns
 * with rings rising, a tram with its trail. Still while the layer is off
 * and for anyone who asks for reduced motion (globals.css,
 * `.data-swatch`).
 */
export function DataLayerSwatch({
  layer,
  on,
}: {
  layer: DataLayerKey;
  on: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "data-swatch relative inline-flex h-3.5 w-8 shrink-0 items-center overflow-hidden rounded-full transition-[opacity,filter]",
        on ? "" : "data-swatch-off opacity-55 saturate-50"
      )}
    >
      {layer === "trafficLayer" && <TrafficSample />}
      {layer === "bikeLayer" && <BikeSample />}
      {layer === "tramLayer" && <TramSample />}
    </span>
  );
}

function TrafficSample() {
  const style: CSSProperties = {
    background: `linear-gradient(90deg, ${tintCss(TRAFFIC_TINTS.calm)}, ${tintCss(TRAFFIC_TINTS.busy)}, ${tintCss(TRAFFIC_TINTS.full)})`,
  };
  return (
    <span
      className="data-swatch-glass absolute inset-x-0 inset-y-0.5 rounded-full"
      style={style}
    >
      <span className="data-swatch-comet absolute inset-y-0 w-2.5 rounded-full" />
    </span>
  );
}

function BikeSample() {
  return (
    <span className="absolute inset-0 flex items-end justify-center gap-1 pb-px">
      {BIKE_DIRECTION_TINTS.map((tint, i) => (
        <span
          className="data-swatch-glass data-swatch-rings h-3 w-1.5 rounded-t-full rounded-b-sm"
          key={tint}
          style={{
            backgroundColor: tintCss(tint),
            animationDelay: `${i * -0.6}s`,
          }}
        />
      ))}
    </span>
  );
}

function TramSample() {
  const style: CSSProperties = {
    background: `linear-gradient(90deg, transparent, ${tintCss(TRAM_TINTS.trail)})`,
  };
  return (
    <span className="data-swatch-tram absolute inset-y-0 left-0 flex w-8 items-center">
      <span className="h-1 w-5 rounded-l-full" style={style} />
      <span
        className="h-2 w-2.5 rounded-sm shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]"
        style={{ backgroundColor: tintCss(TRAM_TINTS.car) }}
      />
    </span>
  );
}
