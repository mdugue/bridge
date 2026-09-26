import { Matrix4, type PerspectiveCamera, Quaternion, Vector3 } from "three";
import { DEG2RAD, directionOf, type Xyz } from "@/lib/city/pose";
import { clamp } from "@/lib/city/math";

/** s — minimum flight time so even a tiny hop reads as a deliberate glide. */
const MIN_DURATION = 1.4;
/** s — cap so the longest cross-tile flight never overstays its welcome. */
const MAX_DURATION = 3.8;
/** s per metre of travel, on top of the base — tunes flights to distance. */
const SECONDS_PER_METRE = 0.0012;
const BASE_DURATION = 0.9;
/** fraction of the travel distance the path bows upward at its midpoint… */
const ARC_RATIO = 0.12;
/** …clamped here so a long flight doesn't balloon into the stratosphere (m). */
const MAX_ARC = 120;

/** Where a flight should end: a pose expressed like CameraState's angles. */
export interface FlightTarget {
  fov: number;
  /** compass degrees, 0 = north, clockwise (east). */
  headingDeg: number;
  /** + = looking up, − = looking down. */
  pitchDeg: number;
  pos: Xyz;
}

interface ActiveFlight {
  arc: number;
  duration: number;
  elapsed: number;
  endFov: number;
  endPos: Vector3;
  endQuat: Quaternion;
  startFov: number;
  startPos: Vector3;
  startQuat: Quaternion;
}

export interface CameraFlight {
  cancel: () => void;
  isActive: () => boolean;
  /** Begins gliding the camera from its current pose to `target`. */
  start: (target: FlightTarget) => void;
  /**
   * Advances the active flight by `dt` seconds, driving the camera. Returns
   * true while a flight owns the camera (so the caller suspends player input).
   */
  update: (dt: number) => boolean;
}

/** Perlin smootherstep — zero velocity AND acceleration at both ends. */
function smootherStep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * A self-contained camera tween for the scenic "fly to a viewpoint" buttons.
 * Position eases along a gently bowed arc (so it reads as flight, not a slide)
 * while orientation slerps — quaternions sidestep the heading wrap / gimbal
 * pitfalls of lerping Euler angles. The target orientation is built from the
 * same direction convention (lib/city/pose.ts) applyCameraState uses, so a
 * flight lands on the identical pose a snapshot would restore instantly.
 */
export function createCameraFlight(camera: PerspectiveCamera): CameraFlight {
  let flight: ActiveFlight | null = null;
  const lookAt = new Vector3();
  const rot = new Matrix4();
  const tmpPos = new Vector3();
  const tmpQuat = new Quaternion();

  const targetQuat = (
    endPos: Vector3,
    headingDeg: number,
    pitchDeg: number
  ) => {
    const d = directionOf(headingDeg * DEG2RAD, pitchDeg * DEG2RAD);
    lookAt.set(endPos.x + d.x, endPos.y + d.y, endPos.z + d.z);
    rot.lookAt(endPos, lookAt, camera.up);
    return new Quaternion().setFromRotationMatrix(rot);
  };

  return {
    isActive: () => flight !== null,
    cancel: () => {
      flight = null;
    },
    start: (target) => {
      const startPos = camera.position.clone();
      const endPos = new Vector3(target.pos.x, target.pos.y, target.pos.z);
      const dist = startPos.distanceTo(endPos);
      flight = {
        startPos,
        endPos,
        startQuat: camera.quaternion.clone(),
        endQuat: targetQuat(endPos, target.headingDeg, target.pitchDeg),
        startFov: camera.fov,
        endFov: target.fov,
        arc: Math.min(dist * ARC_RATIO, MAX_ARC),
        duration: clamp(
          BASE_DURATION + dist * SECONDS_PER_METRE,
          MIN_DURATION,
          MAX_DURATION
        ),
        elapsed: 0,
      };
    },
    update: (dt) => {
      if (!flight) {
        return false;
      }
      flight.elapsed += dt;
      const t = Math.min(flight.elapsed / flight.duration, 1);
      const e = smootherStep(t);
      tmpPos.lerpVectors(flight.startPos, flight.endPos, e);
      // Bow the path upward, peaking at the midpoint, so the camera lifts and
      // settles rather than sliding through whatever sits between the two poses.
      tmpPos.y += flight.arc * Math.sin(Math.PI * e);
      camera.position.copy(tmpPos);
      tmpQuat.slerpQuaternions(flight.startQuat, flight.endQuat, e);
      camera.quaternion.copy(tmpQuat);
      if (flight.startFov !== flight.endFov) {
        camera.fov = flight.startFov + (flight.endFov - flight.startFov) * e;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld(true);
      if (t >= 1) {
        flight = null;
      }
      return true;
    },
  };
}
