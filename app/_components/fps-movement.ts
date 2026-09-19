import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";
import { approachHeight } from "@/lib/city/ground-clamp";

/** m/s. Walk is pedestrian-ish (Shift sprints); fly covers the 2 km tile. */
const WALK_SPEED = 9;
const SPRINT_FACTOR = 3;
const FLY_SPEED = 35;
/** seconds — eye-height smoothing over the ~4 m DGM grid */
const GROUND_TAU = 0.12;

export type MovementMode = "walk" | "fly";

export interface FpsMovementOptions {
  eyeHeight: number;
  /** ground elevation (world Y) at world (x, z); null = off the terrain */
  groundHeight: (x: number, z: number) => number | null;
  /**
   * Optional wall collision (walk mode only): receives the current position
   * and the proposed horizontal step, returns the step to actually apply.
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
  setMode: (mode: MovementMode) => void;
  /** Snaps the eye onto the ground at the current spot (used by teleports). */
  snapToGround: () => void;
  update: (dt: number) => void;
}

/**
 * WASD movement with two modes:
 *  - walk: eye glued to terrain + eyeHeight (smoothed); Shift sprints.
 *  - fly: free movement, Space/Shift move up/down.
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

  const update = (dt: number) => {
    if (mode === "walk") {
      const step = WALK_SPEED * (shiftHeld() ? SPRINT_FACTOR : 1) * dt;
      const proposed = horizontalStep(step);
      const applied = options.resolveStep
        ? options.resolveStep(camera.position, proposed)
        : proposed;
      camera.position.add(applied);
      clampToGround(dt);
      return;
    }
    // Fly mode is deliberately collision-free (QA, aerial shots).
    const step = FLY_SPEED * dt;
    camera.position.add(horizontalStep(step));
    if (keys.has("Space")) {
      camera.position.y += step;
    }
    if (shiftHeld()) {
      camera.position.y -= step;
    }
  };

  return {
    update,
    press: (code) => keys.add(code),
    release: (code) => keys.delete(code),
    releaseAll: () => {
      keys.clear();
      analogX = 0;
      analogY = 0;
    },
    setAnalog: (x, y) => {
      analogX = Math.min(Math.max(x, -1), 1);
      analogY = Math.min(Math.max(y, -1), 1);
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
