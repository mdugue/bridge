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
}

export interface FpsMovement {
  getMode: () => MovementMode;
  press: (code: string) => void;
  release: (code: string) => void;
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
  let mode: MovementMode = "walk";

  const shiftHeld = () => keys.has("ShiftLeft") || keys.has("ShiftRight");

  const moveHorizontally = (step: number) => {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    if (keys.has("KeyW")) {
      camera.position.addScaledVector(forward, step);
    }
    if (keys.has("KeyS")) {
      camera.position.addScaledVector(forward, -step);
    }
    if (keys.has("KeyD")) {
      camera.position.addScaledVector(right, step);
    }
    if (keys.has("KeyA")) {
      camera.position.addScaledVector(right, -step);
    }
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
      moveHorizontally(step);
      clampToGround(dt);
      return;
    }
    const step = FLY_SPEED * dt;
    moveHorizontally(step);
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
