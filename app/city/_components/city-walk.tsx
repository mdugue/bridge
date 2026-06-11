"use client";

import { useEffect, useRef, useState } from "react";
import {
  type CityWalkHandle,
  type CityWalkStats,
  createCityWalkApp,
} from "./create-app";
import { updatePocDebug } from "./poc-debug";
import type { SunState } from "./sun-rig";

interface Props {
  /** URL of the CityJSON tile, served from /public */
  citySrc: string;
  /** URL of the DGM GeoTIFF */
  demSrc: string;
  /** URL of the .tfw sidecar (georef fallback) */
  demTfwSrc?: string;
  /** Optional glTF/GLB to insert; falls back to a marker box */
  insertedModelUrl?: string;
}

type Status =
  | { phase: "loading"; message: string }
  | { phase: "ready" }
  | { phase: "error"; message: string };

// Evaluated once in the browser (the component is loaded with ssr: false).
const INITIAL_DATE = new Date();
const INITIAL_MINUTES = 14 * 60;
const MINUTES_STEP = 5;
const LAST_MINUTE = 24 * 60 - MINUTES_STEP;

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local-time instant from the date input value + minutes-of-day slider. */
function composeDate(dateStr: string, minutes: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, minutes);
}

function formatMinutes(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export default function CityWalk({
  citySrc,
  demSrc,
  demTfwSrc,
  insertedModelUrl,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CityWalkHandle | null>(null);

  const [status, setStatus] = useState<Status>({
    phase: "loading",
    message: "Starting renderer…",
  });
  const [stats, setStats] = useState<CityWalkStats | null>(null);
  const [sun, setSun] = useState<SunState | null>(null);
  const [dateStr, setDateStr] = useState(() => toDateInputValue(INITIAL_DATE));
  const [minutes, setMinutes] = useState(INITIAL_MINUTES);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }
    let cancelled = false;
    let handle: CityWalkHandle | null = null;
    const aborter = new AbortController();

    createCityWalkApp({
      container,
      citySrc,
      demSrc,
      demTfwSrc,
      insertedModelUrl,
      initialDate: composeDate(toDateInputValue(INITIAL_DATE), INITIAL_MINUTES),
      signal: aborter.signal,
      onProgress: (message) => {
        if (!cancelled) {
          setStatus({ phase: "loading", message });
        }
      },
      onStats: (s) => {
        if (!cancelled) {
          setStats(s);
          updatePocDebug({ ready: true, ...s });
        }
      },
    })
      .then((h) => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        handleRef.current = h;
        setSun(
          h.setSun(composeDate(toDateInputValue(INITIAL_DATE), INITIAL_MINUTES))
        );
        updatePocDebug({
          offset: h.offset,
          flyTo: h.flyTo,
          demolishAtCrosshair: h.demolishAtCrosshair,
          insertBuilding: () => {
            h.insertBuilding().catch(() => {
              // glTF failure is non-fatal; the box fallback can't fail
            });
          },
          setSunIso: (iso) => {
            h.setSun(new Date(iso));
          },
        });
        setStatus({ phase: "ready" });
      })
      .catch((err: unknown) => {
        // Aborted = StrictMode remount / navigation away, not a failure.
        const aborted =
          err instanceof DOMException && err.name === "AbortError";
        if (!(cancelled || aborted)) {
          setStatus({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
      aborter.abort();
      handleRef.current = null;
      handle?.dispose();
    };
  }, [citySrc, demSrc, demTfwSrc, insertedModelUrl]);

  const updateSun = (nextDateStr: string, nextMinutes: number) => {
    setDateStr(nextDateStr);
    setMinutes(nextMinutes);
    const state = handleRef.current?.setSun(
      composeDate(nextDateStr, nextMinutes)
    );
    if (state) {
      setSun(state);
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-900">
      <div className="absolute inset-0" ref={mountRef} />

      {status.phase === "loading" && (
        <output
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center bg-slate-900/70 text-lg text-white"
        >
          {status.message}
        </output>
      )}

      {status.phase === "error" && (
        <div
          className="absolute inset-x-8 top-8 rounded-lg border border-red-400 bg-red-950/90 p-4 text-red-100 text-sm"
          role="alert"
        >
          <p className="mb-1 font-semibold">Failed to start the city viewer</p>
          <p className="break-words">{status.message}</p>
        </div>
      )}

      {status.phase === "ready" && (
        <>
          {/* crosshair */}
          <div
            aria-hidden
            className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          />

          <div className="pointer-events-none absolute top-3 left-3 max-w-xs rounded-lg bg-black/60 p-3 text-white text-xs leading-5">
            <p>
              Click the view to capture the mouse · <b>WASD</b> walk ·{" "}
              <b>Space/Shift</b> up/down · <b>R</b> demolish the building under
              the crosshair · <b>B</b> insert a building · <b>Esc</b> release
            </p>
            {stats && (
              <p className="mt-1 text-white/70">
                {stats.buildingCount} buildings ·{" "}
                {stats.terrainVertexCount.toLocaleString()} terrain vertices
              </p>
            )}
          </div>

          <div className="absolute top-3 right-3 w-64 rounded-lg bg-black/60 p-3 text-white text-xs leading-5">
            <p className="mb-2 font-semibold">Sun & shadows</p>
            <label className="mb-2 block">
              Date
              <input
                className="mt-1 block w-full rounded bg-white/10 px-2 py-1 text-white"
                onChange={(e) => updateSun(e.target.value, minutes)}
                type="date"
                value={dateStr}
              />
            </label>
            <label className="block">
              Time of day · {formatMinutes(minutes)}
              <input
                className="mt-1 block w-full"
                max={LAST_MINUTE}
                min={0}
                onChange={(e) => updateSun(dateStr, Number(e.target.value))}
                step={MINUTES_STEP}
                type="range"
                value={minutes}
              />
            </label>
            <p className="mt-2 text-white/70">
              {sun
                ? `Sun altitude ${sun.altitudeDeg.toFixed(1)}°${
                    sun.aboveHorizon ? "" : " — below horizon (night)"
                  }`
                : "Sun position unknown"}
            </p>
            <button
              className="mt-2 w-full rounded bg-white/15 px-2 py-1 font-medium hover:bg-white/25"
              onClick={() => {
                handleRef.current?.insertBuilding().catch(() => {
                  // glTF failure is non-fatal; the box fallback can't fail
                });
              }}
              type="button"
            >
              Insert building (B)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
