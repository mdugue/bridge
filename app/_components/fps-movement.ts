import type { PerspectiveCamera } from "three/webgpu";
import { Vector3 } from "three/webgpu";
import { approachHeight } from "@/lib/city/ground-clamp";

/** m/s. Walk is pedestrian-ish (Shift sprints). */
const WALK_SPEED = 9;
const SPRINT_FACTOR = 3;
/**
 * Flying scales with the height above the ground, like a map's pan speed
 * with its zoom: skimming the street at 15 m/s, 35 m/s at rooftop height,
 * up to 180 m/s high over the city — a phone has no sprint key, and one
 * speed was either a crawl from 300 m up or a blur at 5 m.
 */
const FLY_SPEED = 35;
const FLY_SPEED_MIN = 15;
const FLY_SPEED_MAX = 180;
/** m/s gained per metre above the ground… */
const FLY_SPEED_PER_M = 0.8;
/** …on top of this base (so 35 m/s at about 30 m up). */
const FLY_SPEED_BASE = 10;
/**
 * s — a dolly (pinch, wheel) eases out over about this long instead of
 * jumping: a wheel notch reads as a short push, and the rest of a pinch
 * coasts on a little after the fingers lift.
 */
const DOLLY_TAU = 0.15;
/** m of dolly left over that is no longer worth a frame. */
const DOLLY_EPSILON = 0.01;
/** seconds — eye-height smoothing over the ~4 m DGM grid */
const GROUND_TAU = 0.12;

import type { MovementMode } from "@/lib/city/site";

export type { MovementMode };

/** The key codes movement reads — pressing one is the player taking the wheel. */
export const MOVEMENT_KEYS: ReadonlySet<string> = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "KeyE",
  "KeyQ",
  "ShiftLeft",
  "ShiftRight",
]);

export interface FpsMovementOptions {
  eyeHeight: number;
  /** ground elevation (world Y) at world (x, z); null = off the terrain */
  groundHeight: (x: number, z: number) => number | null;
  /**
   * Optional wall collision (walking and flying): receives the current
   * position and the proposed horizontal step, returns the step to actually
   * apply.
   */
  resolveStep?: (position: Vector3, displacement: Vector3) => Vector3;
}

export interface FpsMovement {
  getMode: () => MovementMode;
  press: (code: string) => void;
  release: (code: string) => void;
  /** Drops every held key and the stick — call when the window loses focus. */
  releaseAll: () => void;
  /**
   * Analog move input from the virtual joystick: x = strafe right,
   * y = forward, both in [-1, 1]. Adds to whatever keys contribute.
   */
  setAnalog: (x: number, y: number) => void;
  /**
   * Analog climb input from the altitude stick (fly mode): +1 climbs at full
   * speed, −1 sinks. Adds to Space/E and Shift/Q.
   */
  setVertical: (v: number) => void;
  setMode: (mode: MovementMode) => void;
  /**
   * Pushes the camera `metres` forward (< 0: back), eased over a few frames:
   * on foot along the ground in the heading, walls stopping it; in the air
   * along the view, down too, never through the ground. Adds up.
   */
  dolly: (metres: number) => void;
  /** Snaps the eye onto the ground at the current spot (used by teleports). */
  snapToGround: () => void;
  update: (dt: number) => void;
}

/**
 * WASD movement with two modes:
 *  - walk: eye glued to terrain + eyeHeight (smoothed); Shift sprints.
 *  - fly: free movement, Space/E climb and Shift/Q sink (or the altitude
 *    stick); sinking stops at eye height above the ground, and facades
 *    stop it like a walker.
 * Horizontal motion always follows the camera heading projected onto the
 * ground plane.
 */
export function createFpsMovement(
  camera: PerspectiveCamera,
  options: FpsMovementOptions
): FpsMovement {
  const keys = new Set<string>();
  const forward = new Vector3();
  const right = new Vector3();
  const displacement = new Vector3();
  let mode: MovementMode = "walk";
  let analogX = 0;
  let analogY = 0;
  let analogV = 0;
  /** dolly metres still to travel */
  let pendingDolly = 0;
  const look = new Vector3();

  const shiftHeld = () => keys.has("ShiftLeft") || keys.has("ShiftRight");

  /** Proposed horizontal step: keys + stick combined, never faster than `step`. */
  const horizontalStep = (step: number): Vector3 => {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    let ix = analogX;
    let iy = analogY;
    if (keys.has("KeyW")) {
      iy += 1;
    }
    if (keys.has("KeyS")) {
      iy -= 1;
    }
    if (keys.has("KeyD")) {
      ix += 1;
    }
    if (keys.has("KeyA")) {
      ix -= 1;
    }
    // Diagonals and stacked stick+key input move at walking speed, not √2x
    // or 2x — this also keeps the collision ray budget honest (the budget is
    // derived from the step length).
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    displacement.set(0, 0, 0);
    displacement.addScaledVector(forward, step * iy);
    displacement.addScaledVector(right, step * ix);
    return displacement;
  };

  const clampToGround = (dt: number) => {
    const ground = options.groundHeight(camera.position.x, camera.position.z);
    if (ground === null) {
      return; // off the DGM: hold the current height
    }
    camera.position.y = approachHeight(
      camera.position.y,
      ground + options.eyeHeight,
      dt,
      GROUND_TAU
    );
  };

  /** Climb input in [-1, 1]: keys + stick combined. */
  const verticalInput = (): number => {
    let v = analogV;
    if (keys.has("Space") || keys.has("KeyE")) {
      v += 1;
    }
    if (shiftHeld() || keys.has("KeyQ")) {
      v -= 1;
    }
    return Math.min(Math.max(v, -1), 1);
  };

  /** Sinks by `dy` (< 0), but never through the ground. */
  const sink = (dy: number) => {
    const ground = options.groundHeight(camera.position.x, camera.position.z);
    const floor =
      ground === null ? Number.NEGATIVE_INFINITY : ground + options.eyeHeight;
    // Already below the floor (a pose set from outside): hold, never yank.
    camera.position.y = Math.max(
      camera.position.y + dy,
      Math.min(floor, camera.position.y)
    );
  };

  /** The horizontal step, slid along (or stopped by) a facade it meets. */
  const collide = (proposed: Vector3): Vector3 =>
    options.resolveStep
      ? options.resolveStep(camera.position, proposed)
      : proposed;

  /** This frame's share of the pending dolly (m). */
  const dollyStep = (dt: number): number => {
    if (pendingDolly === 0) {
      return 0;
    }
    let take = pendingDolly * (1 - Math.exp(-dt / DOLLY_TAU));
    if (Math.abs(pendingDolly - take) < DOLLY_EPSILON) {
      take = pendingDolly;
    }
    pendingDolly -= take;
    return take;
  };

  /** Fly speed (m/s) at the camera's height above the ground. */
  const flySpeed = (): number => {
    const ground = options.groundHeight(camera.position.x, camera.position.z);
    if (ground === null) {
      return FLY_SPEED;
    }
    const above = Math.max(camera.position.y - ground, 0);
    return Math.min(
      Math.max(FLY_SPEED_BASE + above * FLY_SPEED_PER_M, FLY_SPEED_MIN),
      FLY_SPEED_MAX
    );
  };

  const update = (dt: number) => {
    const dolly = dollyStep(dt);
    if (mode === "walk") {
      const step = WALK_SPEED * (shiftHeld() ? SPRINT_FACTOR : 1) * dt;
      // horizontalStep leaves the level heading in `forward`.
      const proposed = horizontalStep(step).addScaledVector(forward, dolly);
      camera.position.add(collide(proposed));
      clampToGround(dt);
      return;
    }
    // Flying meets the facades too: a flight never passes into a building
    // (over its roof it has nothing to meet). The roofs themselves are
    // camera-pose.ts's clearance guard. A dolly runs along the view itself,
    // so pinching while looking down sinks towards what is under the cross.
    const step = flySpeed() * dt;
    camera.getWorldDirection(look);
    const proposed = horizontalStep(step);
    proposed.x += look.x * dolly;
    proposed.z += look.z * dolly;
    camera.position.add(collide(proposed));
    const climb = verticalInput() * step + look.y * dolly;
    if (climb > 0) {
      camera.position.y += climb;
    } else if (climb < 0) {
      sink(climb);
    }
  };

  return {
    update,
    press: (code) => {
      if (MOVEMENT_KEYS.has(code)) {
        keys.add(code);
      }
    },
    release: (code) => keys.delete(code),
    releaseAll: () => {
      keys.clear();
      analogX = 0;
      analogY = 0;
      analogV = 0;
      pendingDolly = 0;
    },
    dolly: (metres) => {
      if (Number.isFinite(metres)) {
        pendingDolly += metres;
      }
    },
    setAnalog: (x, y) => {
      analogX = Math.min(Math.max(x, -1), 1);
      analogY = Math.min(Math.max(y, -1), 1);
    },
    setVertical: (v) => {
      analogV = Math.min(Math.max(v, -1), 1);
    },
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
      // A push meant for one mode is not carried into the other.
      pendingDolly = 0;
    },
    snapToGround: () => {
      const ground = options.groundHeight(camera.position.x, camera.position.z);
      if (ground !== null) {
        camera.position.y = ground + options.eyeHeight;
      }
    },
  };
}
