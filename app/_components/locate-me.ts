import {
  deviceHeadingDeg,
  type GeoFix,
  type Placement,
} from "@/lib/city/geolocation";

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

/** iOS Safari's compass: degrees from north, clockwise; −1 = uncalibrated. */
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** iOS 13+ asks before it hands out orientation events. */
type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"denied" | "granted">;
};

/** A compass heading from one orientation event, or null if it has none. */
function headingOf(e: CompassEvent): number | null {
  if (typeof e.webkitCompassHeading === "number") {
    return e.webkitCompassHeading >= 0 ? e.webkitCompassHeading : null;
  }
  // A relative alpha is measured from wherever the page happened to start —
  // no use as a compass.
  if (!e.absolute || e.alpha === null) {
    return null;
  }
  return deviceHeadingDeg(
    e.alpha,
    e.beta ?? 0,
    e.gamma ?? 0,
    screen.orientation?.angle ?? 0
  );
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
 * grants `requestPermission` from a user gesture, and the gesture is gone
 * once the first `await` yields.
 */
function startCompass() {
  const samples: number[] = [];
  let wake: (() => void) | null = null;
  const onEvent = (event: Event) => {
    const heading = headingOf(event as CompassEvent);
    if (heading === null) {
      return;
    }
    samples.push(heading);
    if (samples.length > COMPASS_SAMPLES) {
      samples.shift();
    }
    wake?.();
  };
  // Chrome's plain `deviceorientation` is relative; the absolute stream is a
  // separate event. Safari has only the plain one, carrying its own compass.
  const type =
    "ondeviceorientationabsolute" in window
      ? "deviceorientationabsolute"
      : "deviceorientation";
  const listen = () => window.addEventListener(type, onEvent);
  const ctor = window.DeviceOrientationEvent as OrientationCtor | undefined;
  if (typeof ctor?.requestPermission === "function") {
    ctor.requestPermission().then(
      (state) => state === "granted" && listen(),
      () => undefined
    );
  } else if (ctor) {
    listen();
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
    stop: () => window.removeEventListener(type, onEvent),
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
