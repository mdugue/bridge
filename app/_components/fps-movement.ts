import type { PerspectiveCamera } from "three/webgpu";
import { Vector3 } from "three/webgpu";
import { approachHeight } from "@/lib/city/ground-clamp";

/** m/s. Walk is pedestrian-ish (Shift sprints); fly covers the 2 km tile. */
const WALK_SPEED = 9;
const SPRINT_FACTOR = 3;
const FLY_SPEED = 35;
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

  const update = (dt: number) => {
    if (mode === "walk") {
      const step = WALK_SPEED * (shiftHeld() ? SPRINT_FACTOR : 1) * dt;
      camera.position.add(collide(horizontalStep(step)));
      clampToGround(dt);
      return;
    }
    // Flying meets the facades too: a flight never passes into a building
    // (over its roof it has nothing to meet). The roofs themselves are
    // camera-pose.ts's clearance guard.
    const step = FLY_SPEED * dt;
    camera.position.add(collide(horizontalStep(step)));
    const climb = verticalInput() * step;
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
    },
    snapToGround: () => {
      const ground = options.groundHeight(camera.position.x, camera.position.z);
      if (ground !== null) {
        camera.position.y = ground + options.eyeHeight;
      }
    },
  };
}
