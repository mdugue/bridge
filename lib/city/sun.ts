import { getPosition, getTimes, type SunTimes } from "suncalc";
import { DEG2RAD } from "./pose";

/**
 * Solar direction math, kept three-free so it is unit-testable.
 *
 * Frames involved:
 *  - suncalc 2.x reports `azimuth` as compass DEGREES, north-based clockwise
 *    (0 = N, 90 = E, 180 = S, 270 = W), and `altitude` as degrees above the
 *    horizon. (suncalc 1.x measured azimuth FROM SOUTH toward west, in
 *    radians — hence the sign flip against the pre-2.0 version of this file.)
 *  - ENU: x=east, y=north, z=up (a map-style local tangent frame).
 *  - World (three.js scene): the city group is rotated -90° about X so the
 *    data's Z-up becomes Y-up. That maps East=+X, Up=+Y, North=-Z.
 */

export interface Enu {
  east: number;
  north: number;
  up: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Unit vector pointing TOWARD the sun in the ENU frame. */
export function sunDirectionEnu(date: Date, lat: number, lng: number): Enu {
  const { azimuth, altitude } = getPosition(date, lat, lng);
  const az = azimuth * DEG2RAD;
  const alt = altitude * DEG2RAD;
  const horizontal = Math.cos(alt);
  return {
    // azimuth 0 = sun due NORTH -> east component 0, north component +1.
    east: horizontal * Math.sin(az),
    north: horizontal * Math.cos(az),
    up: Math.sin(alt),
  };
}

/** ENU -> world mapping for the -90°-about-X scene: East=+X, Up=+Y, North=-Z. */
export function enuToWorld(enu: Enu): Vec3 {
  return { x: enu.east, y: enu.up, z: -enu.north };
}

/**
 * Unit vector pointing TOWARD the sun in world (three.js) coordinates.
 * y > 0 means the sun is above the horizon.
 */
export function sunDirectionWorld(date: Date, lat: number, lng: number): Vec3 {
  return enuToWorld(sunDirectionEnu(date, lat, lng));
}

/**
 * Sunrise, sunset and the rest for the calendar day `day` names (its
 * year, month and date as the browser reads them), at the city: that day
 * in the city's mean solar time, its offset from the longitude. Without an
 * offset suncalc takes the solar day nearest the instant, and a day picked
 * as local midnight lies nearer the previous day's noon east of Greenwich
 * — the times were the day before's (suncalc 2.1 added the offset). The
 * browser's own zone would not do either: from UTC+13 the city's previous
 * day is still the nearer one.
 */
export function sunTimesOn(day: Date, lat: number, lng: number): SunTimes {
  const noon = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12);
  return getTimes(new Date(noon), lat, lng, 0, Math.round((lng / 15) * 60));
}
