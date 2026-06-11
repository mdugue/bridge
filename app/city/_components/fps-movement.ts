import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";

/** m/s — brisk pace for a 2 km tile. */
const SPEED = 25;

export interface FpsMovement {
  press: (code: string) => void;
  release: (code: string) => void;
  update: (dt: number) => void;
}

/**
 * WASD + Space/Shift free movement. Horizontal motion follows the camera
 * heading projected onto the ground plane; vertical motion is world-Y.
 */
export function createFpsMovement(camera: PerspectiveCamera): FpsMovement {
  const keys = new Set<string>();
  const forward = new Vector3();
  const right = new Vector3();

  const update = (dt: number) => {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    const step = SPEED * dt;
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
    if (keys.has("Space")) {
      camera.position.y += step;
    }
    if (keys.has("ShiftLeft") || keys.has("ShiftRight")) {
      camera.position.y -= step;
    }
  };

  return {
    update,
    press: (code) => keys.add(code),
    release: (code) => keys.delete(code),
  };
}
