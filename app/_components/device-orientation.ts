import {
  type DeviceAim,
  deviceAim,
  devicePitchDeg,
} from "@/lib/city/geolocation";

/** iOS Safari's compass: degrees from north, clockwise; −1 = uncalibrated. */
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** iOS 13+ asks before it hands out orientation events. */
type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"denied" | "granted">;
};

function ctor(): OrientationCtor | undefined {
  return typeof window === "undefined"
    ? undefined
    : window.DeviceOrientationEvent;
}

/**
 * Chrome's plain `deviceorientation` is relative to wherever the page
 * started; its compass is a separate, absolute stream. Safari has only the
 * plain one, which carries its own `webkitCompassHeading`.
 */
function eventType(): string {
  return "ondeviceorientationabsolute" in window
    ? "deviceorientationabsolute"
    : "deviceorientation";
}

/** Where the phone looks (TRUE heading), or null if the event has no compass. */
export function aimOf(e: CompassEvent): DeviceAim | null {
  if (typeof e.webkitCompassHeading === "number") {
    // iOS measures the heading itself; its beta/gamma still give the pitch.
    return e.webkitCompassHeading >= 0
      ? {
          headingDeg: e.webkitCompassHeading,
          pitchDeg: devicePitchDeg(e.beta ?? 90, e.gamma ?? 0),
        }
      : null;
  }
  // A relative alpha is no use as a compass.
  if (!e.absolute || e.alpha === null) {
    return null;
  }
  return deviceAim(
    e.alpha,
    e.beta ?? 0,
    e.gamma ?? 0,
    typeof screen === "undefined" ? 0 : (screen.orientation?.angle ?? 0)
  );
}

/** True where orientation events wait for a permission prompt (iOS 13+). */
export function orientationNeedsPermission(): boolean {
  return typeof ctor()?.requestPermission === "function";
}

/**
 * Asks for the orientation events where the platform wants that (iOS); true
 * elsewhere. Must be called straight from a click — iOS only grants it
 * inside a user gesture, which is gone once the first `await` yields.
 */
export function requestOrientationPermission(): Promise<boolean> {
  const request = ctor()?.requestPermission;
  if (typeof request !== "function") {
    return Promise.resolve(ctor() !== undefined);
  }
  return request().then(
    (state) => state === "granted",
    () => false
  );
}

/**
 * Calls `cb` with every compass-bearing orientation reading. Events that
 * carry no compass are dropped; on iOS nothing arrives until the permission
 * was granted. Returns the unsubscribe.
 */
export function subscribeAim(cb: (aim: DeviceAim) => void): () => void {
  if (!ctor()) {
    return () => undefined;
  }
  const type = eventType();
  const onEvent = (event: Event) => {
    const aim = aimOf(event as CompassEvent);
    if (aim) {
      cb(aim);
    }
  };
  window.addEventListener(type, onEvent);
  return () => window.removeEventListener(type, onEvent);
}
