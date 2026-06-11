import SunCalc from "suncalc";

/**
 * Solar direction math, kept three-free so it is unit-testable.
 *
 * Frames involved:
 *  - SunCalc azimuth is measured FROM SOUTH, positive towards WEST;
 *    altitude is the angle above the horizon. Both in radians.
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
  const { azimuth, altitude } = SunCalc.getPosition(date, lat, lng);
  const horizontal = Math.cos(altitude);
  return {
    // azimuth 0 = sun due SOUTH -> east component 0, north component -1.
    east: -horizontal * Math.sin(azimuth),
    north: -horizontal * Math.cos(azimuth),
    up: Math.sin(altitude),
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
