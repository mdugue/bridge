import type { DeviceAim, GeoFix, Placement } from "@/lib/city/geolocation";
import {
  orientationNeedsPermission,
  requestOrientationPermission,
  subscribeAim,
} from "./device-orientation";

/** How long to wait for a first compass reading once the fix is in (ms). */
const COMPASS_WAIT_MS = 1200;
/** Readings averaged into the heading — a phone compass jitters by degrees. */
const COMPASS_SAMPLES = 6;
const GEO_TIMEOUT_MS = 15_000;

export type LocateFailure =
  | "denied"
  | "position-unavailable"
  | "timeout"
  | "unsupported";

/** Why a fix could not be had; `reason` is what the HUD words. */
export class LocateError extends Error {
  readonly reason: LocateFailure;
  constructor(reason: LocateFailure) {
    super(reason);
    this.reason = reason;
  }
}

/** Circular mean of bearings in degrees (359° and 1° average to 0°). */
function meanBearing(samples: number[]): number {
  let s = 0;
  let c = 0;
  for (const deg of samples) {
    s += Math.sin((deg * Math.PI) / 180);
    c += Math.cos((deg * Math.PI) / 180);
  }
  return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
}

/**
 * Starts listening to the compass. Must run inside the click: iOS only
 * grants the orientation permission from a user gesture, and the gesture is
 * gone once the first `await` yields.
 */
function startCompass() {
  const samples: number[] = [];
  let wake: (() => void) | null = null;
  const onAim = (aim: DeviceAim) => {
    samples.push(aim.headingDeg);
    if (samples.length > COMPASS_SAMPLES) {
      samples.shift();
    }
    wake?.();
  };
  // Listen at once, and ask in parallel where the platform wants that:
  // before the grant nothing arrives (iOS), and a reading that comes in
  // while a permission promise settles is not lost (Chromium has
  // `requestPermission` too, and grants it without a prompt).
  const stop = subscribeAim(onAim);
  if (orientationNeedsPermission()) {
    requestOrientationPermission().catch(() => undefined);
  }
  return {
    /** The averaged heading, waiting up to `ms` for a first reading. */
    read: async (ms: number): Promise<number | null> => {
      if (samples.length === 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      return samples.length > 0 ? meanBearing(samples) : null;
    },
    stop,
  };
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        const reasons: Record<number, LocateFailure> = {
          [err.PERMISSION_DENIED]: "denied",
          [err.POSITION_UNAVAILABLE]: "position-unavailable",
          [err.TIMEOUT]: "timeout",
        };
        reject(new LocateError(reasons[err.code] ?? "position-unavailable"));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: GEO_TIMEOUT_MS }
    );
  });
}

/** Whether this browser can locate the player at all. */
export function canLocate(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Where the player is in the real world and which way the phone points —
 * the heading is a TRUE bearing, null without a (permitted) compass. Call it
 * straight from a click handler (see startCompass). Rejects with a
 * LocateError.
 */
export async function locateMe(): Promise<GeoFix> {
  if (!canLocate()) {
    throw new LocateError("unsupported");
  }
  const compass = startCompass();
  try {
    const pos = await currentPosition();
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      headingDeg: await compass.read(COMPASS_WAIT_MS),
    };
  } finally {
    compass.stop();
  }
}

const METRES = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const KILOMETRES = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/**
 * A distance the way the HUD says it: metres up to a kilometre, then km —
 * whole ones from ten on.
 */
export function formatDistance(m: number): string {
  if (m < 1000) {
    return `${METRES.format(m)} m`;
  }
  return m < 10_000
    ? `${KILOMETRES.format(m / 1000)} km`
    : `${METRES.format(m / 1000)} km`;
}

const FAILURES: Record<LocateFailure, string> = {
  denied: "Standortzugriff verweigert — in den Browser-Einstellungen freigeben",
  "position-unavailable": "Standort gerade nicht verfügbar",
  timeout: "Standort nicht gefunden (Zeitüberschreitung)",
  unsupported: "Dieser Browser kann den Standort nicht bestimmen",
};

/** The HUD line for a locate attempt that went nowhere. */
export function describeFailure(err: unknown): string {
  return err instanceof LocateError
    ? FAILURES[err.reason]
    : "Standort konnte nicht bestimmt werden";
}

/** The HUD line for a placement (lib/city/geolocation.ts). */
export function describePlacement(
  placement: Placement,
  siteLabel: string
): string {
  switch (placement.kind) {
    case "inside": {
      const at = `Du bist hier — auf ±${formatDistance(placement.accuracy)} genau`;
      return placement.headingDeg === null
        ? `${at}, Blickrichtung ohne Kompass beibehalten`
        : at;
    }
    case "outside":
      return `Du bist ${formatDistance(placement.distanceM)} außerhalb von ${siteLabel} — dort gibt es noch keine Stadt`;
    case "unsupported":
      return "Dein Standort lässt sich nicht auf diese Karte übertragen";
  }
}
