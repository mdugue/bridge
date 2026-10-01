"use client";

import type { ReactNode } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  BIKE_DIRECTION_TINTS,
  type BikeCounter,
  tintCss,
} from "@/lib/city/bike-counts";
import { DATA_LAYERS, type DataLayerKey } from "@/lib/city/data-layers";
import type { LookValues } from "@/lib/city/look-controls";
import type { TramCarsStatus } from "./tram-cars";

/**
 * The data layers' switches (lib/city/data-layers.ts): one per layer, its
 * line of explanation, and — while it is on — its credit and whatever the
 * layer has to say in words (`detail`; the scene itself carries no text).
 */
export function DataLayersPanel({
  detail,
  look,
  onLook,
}: {
  detail?: Partial<Record<DataLayerKey, ReactNode>>;
  look: LookValues;
  onLook: (patch: Partial<LookValues>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {DATA_LAYERS.map((def) => (
        <div className="flex flex-col gap-1" key={def.key}>
          <Field orientation="horizontal">
            <FieldLabel className="font-medium text-xs" htmlFor={def.id}>
              {def.label}
            </FieldLabel>
            <Switch
              checked={look[def.key]}
              id={def.id}
              onCheckedChange={(checked) => {
                const patch: Partial<LookValues> = {};
                patch[def.key] = checked;
                onLook(patch);
              }}
              size="sm"
            />
          </Field>
          <FieldDescription className="text-[11px] leading-snug">
            {def.description}
          </FieldDescription>
          {look[def.key] && (
            <>
              {detail?.[def.key]}
              <span className="text-[10px] text-muted-foreground">
                {def.source}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** "07:00 Uhr" for the newest hour any counter reported. */
function countHour(counters: BikeCounter[]): string | null {
  const times = counters.flatMap((c) =>
    c.measuredAt ? [c.measuredAt.getTime()] : []
  );
  if (times.length === 0) {
    return null;
  }
  const t = new Date(Math.max(...times));
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} Uhr`;
}

/**
 * The live bicycle counts in words (the scene shows them as columns): one
 * row per counter, busiest first, a count per direction in its column's
 * colour; a click flies there.
 */
export function BikeCountList({
  counters,
  onFly,
}: {
  counters: BikeCounter[];
  onFly: (counter: BikeCounter) => void;
}) {
  if (counters.length === 0) {
    return (
      <span className="text-[11px] text-muted-foreground">
        Zählwerte werden geladen …
      </span>
    );
  }
  const total = (c: BikeCounter) =>
    c.directions.reduce((sum, d) => sum + d.count, 0);
  const rows = [...counters].sort((a, b) => total(b) - total(a));
  const hour = countHour(counters);
  return (
    <div className="flex flex-col gap-1">
      {hour && (
        <span className="text-[11px] text-muted-foreground">
          Räder in der Stunde bis {hour}
        </span>
      )}
      <ul
        aria-label="Radzählstellen"
        className="flex max-h-48 flex-col overflow-y-auto pr-1"
        id="bike-counts"
      >
        {rows.map((c) => (
          <li key={c.id}>
            <button
              className="-mx-1 flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-accent"
              onClick={() => onFly(c)}
              title={`${c.where} — hinfliegen`}
              type="button"
            >
              <span className="flex-1 truncate">{c.name}</span>
              {c.directions.map((d, i) => (
                <span
                  className="flex items-center gap-1 font-mono tabular-nums"
                  key={d.toward}
                  title={`Richtung ${d.toward}`}
                >
                  <span
                    aria-hidden
                    className="inline-block size-1.5 rounded-full"
                    style={{ background: tintCss(BIKE_DIRECTION_TINTS[i % 2]) }}
                  />
                  {d.count}
                </span>
              ))}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAY_KIND_LABEL: Record<TramCarsStatus["kind"], string> = {
  weekday: "Werktag",
  saturday: "Samstag",
  sunday: "Sonntag",
};

/** "2026-10-01" → "1.10.2026". */
function germanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

/** The timetable trams in words: how many run now, from which day's
 *  timetable. */
export function TramStatusLine({ status }: { status: TramCarsStatus | null }) {
  if (!status) {
    return (
      <span className="text-[11px] text-muted-foreground">
        Fahrplan wird geladen …
      </span>
    );
  }
  const day = DAY_KIND_LABEL[status.kind];
  return (
    <span className="text-[11px] text-muted-foreground" id="tram-status">
      {status.running === 1
        ? "1 Bahn unterwegs"
        : `${status.running} Bahnen unterwegs`}
      {status.date
        ? ` · Fahrplan ${day} (${germanDate(status.date)})`
        : ` · kein Fahrplan für ${day}`}
    </span>
  );
}
