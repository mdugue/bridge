/**
 * "Where am I?" — the pure half of locating the player in the real world: a
 * GPS fix to the site's projected CRS, a phone's orientation to a compass
 * heading, and whether the fix lies on the rendered site at all. The DOM
 * adapter (app/_components/locate-me.ts) feeds it. No THREE, no DOM.
 */
import { gridConvergenceDeg, latLngToUtm } from "./crs";
import type { TerrainBounds } from "./terrain-geometry";

const DEG = Math.PI / 180;

/** A bearing folded into [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The compass heading (degrees, 0 = north, clockwise) a phone is pointed
 * in, from a DeviceOrientation reading in the earth frame (`alpha`, `beta`,
 * `gamma` in degrees, W3C's intrinsic Z-X'-Y'' order) and the screen's
 * rotation (`screen.orientation.angle`).
 *
 * "Pointed in" is two directions blended: where the back camera looks (the
 * device's −Z) and where the top of the screen points (its +Y turned by the
 * screen angle). Held upright, the camera dominates — you aim the phone at
 * the street; laid flat it looks at the floor and the top edge takes over,
 * like a map. Summing their horizontal parts hands over smoothly between the
 * two. Null when neither points anywhere horizontal.
 */
export function deviceHeadingDeg(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle = 0
): number | null {
  const [sA, cA] = [Math.sin(alpha * DEG), Math.cos(alpha * DEG)];
  const [sB, cB] = [Math.sin(beta * DEG), Math.cos(beta * DEG)];
  const [sG, cG] = [Math.sin(gamma * DEG), Math.cos(gamma * DEG)];
  // Columns of R = Rz(alpha)·Rx(beta)·Ry(gamma), earth frame x = east,
  // y = north: the device's +X, +Y and −Z axes, horizontal parts only.
  const xAxis = { e: cA * cG - sA * sB * sG, n: sA * cG + cA * sB * sG };
  const yAxis = { e: -sA * cB, n: cA * cB };
  const back = { e: -cA * sG - sA * sB * cG, n: -sA * sG + cA * sB * cG };
  // Screen "up" in device coordinates: rotating the screen by +θ (counter-
  // clockwise, landscape-primary at 90°) turns up towards the device's +X.
  const [sS, cS] = [Math.sin(screenAngle * DEG), Math.cos(screenAngle * DEG)];
  const e = back.e + sS * xAxis.e + cS * yAxis.e;
  const n = back.n + sS * xAxis.n + cS * yAxis.n;
  if (Math.hypot(e, n) < 1e-3) {
    return null;
  }
  return normalizeDeg(Math.atan2(e, n) / DEG);
}

/** How far (m) a projected point lies outside a bounds box; 0 = inside. */
export function distanceOutside(
  bounds: TerrainBounds,
  x: number,
  y: number
): number {
  const [minX, minY, maxX, maxY] = bounds;
  const dx = Math.max(minX - x, 0, x - maxX);
  const dy = Math.max(minY - y, 0, y - maxY);
  return Math.hypot(dx, dy);
}

export interface GeoFix {
  /** radius of the 68 % confidence circle, m (Geolocation API) */
  accuracy: number;
  /** compass bearing from TRUE north, degrees; null = no compass */
  headingDeg: number | null;
  lat: number;
  lng: number;
}

export type Placement =
  | {
      kind: "inside";
      accuracy: number;
      epsgX: number;
      epsgY: number;
      /** grid bearing the scene uses (0 = +Y), null = keep the current one */
      headingDeg: number | null;
    }
  | { kind: "outside"; distanceM: number }
  | { kind: "unsupported" };

/**
 * Where a GPS fix puts the player on the site, and facing which way. A fix
 * off the site is reported with its distance instead — there is no city
 * there to stand in. The compass bearing is turned from true to grid north
 * (the meridian convergence, ≈ 1° here); magnetic declination is left to the
 * platform, which is as good as a phone compass gets anyway.
 */
export function placementOf(
  fix: GeoFix,
  epsg: number,
  bounds: TerrainBounds
): Placement {
  const at = latLngToUtm(epsg, fix.lat, fix.lng);
  const convergence = gridConvergenceDeg(epsg, fix.lat, fix.lng);
  if (!at || convergence === null) {
    return { kind: "unsupported" };
  }
  const off = distanceOutside(bounds, at.x, at.y);
  if (off > 0) {
    return { kind: "outside", distanceM: off };
  }
  return {
    kind: "inside",
    accuracy: fix.accuracy,
    epsgX: at.x,
    epsgY: at.y,
    headingDeg:
      fix.headingDeg === null
        ? null
        : normalizeDeg(fix.headingDeg + convergence),
  };
}
