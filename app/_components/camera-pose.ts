import { Euler, type PerspectiveCamera, Vector3 } from "three";
import {
  epsgToWorld,
  type RecenterOffset,
  worldToEpsg,
} from "@/lib/city/ground-clamp";
import {
  type CameraState,
  clampPitch,
  DEG2RAD,
  directionOf,
  EYE_HEIGHT,
  headingPitchOf,
  nextFov,
  type PlayerPose,
  RAD2DEG,
  type Xyz,
} from "@/lib/city/pose";
import { easeAngleDeg } from "@/lib/city/geolocation";
import { createCameraFlight, type FlightTarget } from "./camera-flight";
import {
  createFpsMovement,
  type FpsMovementOptions,
  MOVEMENT_KEYS,
  type MovementMode,
} from "./fps-movement";
import type { ViewpointGeometry } from "@/lib/city/site";

/**
 * Time constant of the follow ease (s): long enough to swallow a phone
 * compass's jitter, short enough that the view still feels attached.
 */
const FOLLOW_TAU = 0.12;
/**
 * The position's ease (s): GPS fixes arrive about once a second and scatter
 * by metres, so the camera glides between them rather than hopping.
 */
const FOLLOW_POSITION_TAU = 1;
/** A fix further than this (m) is a jump, not a step: land at once. */
const FOLLOW_SNAP_M = 40;

/** A view direction in compass degrees on the scene's grid. */
export interface FollowAim {
  headingDeg: number;
  pitchDeg: number;
}

/** rad per CSS px of grab-look drag — a full phone-width swipe ≈ 90° */
const GRAB_RADIANS_PER_PX = 0.004;
/** rad per CSS px of pointer-locked mouse motion (half the grab speed). */
const MOUSE_RADIANS_PER_PX = 0.002;

export interface CameraPoseOptions {
  /**
   * The lowest real terrain elevation (world Y) so far: where the player
   * stands when a spot lies off every tile's DGM. A getter because it drops
   * as more tiles land.
   */
  groundFloor: () => number;
  /** ground elevation (world Y) at EPSG (x, y); null = off every tile */
  heightAt: (epsgX: number, epsgY: number) => number | null;
  offset: RecenterOffset;
  /**
   * Live mode ended because the player took over by hand — looked around,
   * or walked with the keys or the stick — and the HUD un-presses its
   * toggle. Not called when the HUD itself switches it off.
   */
  onFollowEnd?: () => void;
  onModeChange?: (mode: MovementMode) => void;
  /**
   * A pose set from outside (spawn, teleport, snapshot): reported at once so
   * the minimap doesn't lag a tick behind. The render loop samples getPose
   * for the continuous updates.
   */
  onPose?: (pose: PlayerPose) => void;
  /** wall collision for walking (collision.ts) */
  resolveStep?: FpsMovementOptions["resolveStep"];
}

export interface CameraPose {
  /** Restores a camera pose captured by getCameraState (snapshot replay). */
  applyCameraState: (state: CameraState) => void;
  /** Captures the FOV a pinch starts from; zoomTo is relative to it. */
  beginZoom: () => void;
  /** Drops a scenic glide in progress — the player took the wheel. */
  cancelGlide: () => void;
  /**
   * Teleports the camera (world/Y-up coords) — used by tests and QA.
   * Switches to fly mode so the ground clamp doesn't drag the camera down.
   */
  flyTo: (position: Xyz, lookAt: Xyz) => void;
  /**
   * Smoothly glides the camera to a curated scenic Viewpoint (animated, unlike
   * the instant applyCameraState), landing in the viewpoint's movement mode.
   */
  flyToViewpoint: (viewpoint: ViewpointGeometry) => void;
  /**
   * The pose as a vantage the glide can fly back to. Height is captured
   * ABOVE THE TERRAIN, like the curated viewpoints, so the saved view still
   * lands correctly once a finer tile refines the ground under it.
   */
  captureViewpoint: () => ViewpointGeometry;
  /** Captures the full camera pose for a reproducible snapshot. */
  getCameraState: () => CameraState;
  getMode: () => MovementMode;
  getPose: () => PlayerPose;
  /**
   * Puts the camera on a viewpoint at once, no glide — the spawn. Lands in
   * the viewpoint's movement mode.
   */
  placeAt: (viewpoint: ViewpointGeometry) => void;
  /** Mouse-look (pointer lock): motion in CSS px, the view follows it. */
  look: (dxPx: number, dyPx: number) => void;
  /** A movement key went down (other codes are ignored). */
  press: (code: string) => void;
  release: (code: string) => void;
  /** Drops every held key and the stick — the window lost focus. */
  releaseAll: () => void;
  /** analog altitude-stick input (fly mode): +1 climbs, −1 sinks */
  setClimbInput: (v: number) => void;
  /** analog joystick input: x = strafe right, y = forward, both [-1, 1] */
  setMoveInput: (x: number, y: number) => void;
  setMovementMode: (mode: MovementMode) => void;
  /**
   * Live mode, the view half: the aim (grid heading + pitch, degrees) the
   * view eases towards every step, or null to stop. A glide suspends it;
   * a manual look or move ends live mode (onFollowEnd) — climbing, sinking
   * and switching to fly mode do not.
   */
  setFollowAim: (aim: FollowAim | null) => void;
  /**
   * Live mode, the position half: the EPSG ground point (a GPS fix) the
   * camera eases towards, or null to stop. A jump further than
   * FOLLOW_SNAP_M (the first fix, a fix after a tunnel) lands at once.
   * Only x/z follow: on foot the ground clamp sets the height, in the air
   * the camera keeps its altitude.
   */
  setFollowPosition: (epsg: { x: number; y: number } | null) => void;
  /** Advances the glide or the player's movement by `dt` seconds. */
  step: (dt: number) => void;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo: (epsgX: number, epsgY: number) => void;
  toggleMode: () => void;
  /** Grab-look: drag deltas in CSS px (dragging right turns the view left). */
  turn: (dxPx: number, dyPx: number) => void;
  /** Wheel zoom: `ratio` > 1 zooms in, relative to the current FOV. */
  zoomBy: (ratio: number) => void;
  /** Pinch zoom: `ratio` = finger distance / distance at beginZoom. */
  zoomTo: (ratio: number) => void;
}

/**
 * Owns the camera's pose: where the player stands, which way they look, walk
 * vs fly, and the scenic glides. Every way the pose can change goes through
 * here, which is what makes the one rule enforceable: **any player input
 * takes the wheel** — a movement key, the stick, a drag, a zoom or a mode
 * switch cancels a scenic glide instead of fighting it or being swallowed by
 * it. Poses set from outside (spawn, teleport, snapshot) do the same.
 *
 * Movement physics is fps-movement.ts, the tween is camera-flight.ts; the
 * DOM adapters (keyboard-controls.ts, touch-controls.ts) translate events
 * into these calls.
 */
export function createCameraPose(
  camera: PerspectiveCamera,
  opts: CameraPoseOptions
): CameraPose {
  const { offset } = opts;
  const movement = createFpsMovement(camera, {
    eyeHeight: EYE_HEIGHT,
    groundHeight: (x, z) => {
      const epsg = worldToEpsg(x, z, offset);
      return opts.heightAt(epsg.x, epsg.y);
    },
    resolveStep: opts.resolveStep,
  });
  const flight = createCameraFlight(camera);
  /** The mode a scenic glide settles into on the frame it lands. */
  let pendingMode: MovementMode | null = null;
  let zoomStartFov = camera.fov;
  let followAim: FollowAim | null = null;
  /** world x/z the camera eases towards in live mode */
  let followPos: { x: number; z: number } | null = null;
  const dir = new Vector3();
  const euler = new Euler(0, 0, 0, "YXZ");

  const groundAt = (epsgX: number, epsgY: number): number =>
    opts.heightAt(epsgX, epsgY) ?? opts.groundFloor();

  const getPose = (): PlayerPose => {
    camera.getWorldDirection(dir);
    const epsg = worldToEpsg(camera.position.x, camera.position.z, offset);
    return {
      epsgX: epsg.x,
      epsgY: epsg.y,
      heading: headingPitchOf(dir).heading,
    };
  };

  /** After a jump: callers may raycast (demolish) before the next frame. */
  const poseJumped = () => {
    camera.updateMatrixWorld(true);
    opts.onPose?.(getPose());
  };

  const cancelGlide = () => {
    flight.cancel();
    pendingMode = null;
  };

  /** Mode change without touching the glide — the glide itself uses it. */
  const settle = (mode: MovementMode) => {
    movement.setMode(mode);
    if (mode === "walk") {
      movement.snapToGround();
    }
    opts.onModeChange?.(mode);
  };

  const setMovementMode = (mode: MovementMode) => {
    cancelGlide();
    settle(mode);
  };

  const setFov = (fov: number) => {
    cancelGlide();
    camera.fov = fov;
    camera.updateProjectionMatrix();
  };

  /** Where a viewpoint puts the camera, on the ground as it stands now. */
  const targetOf = (viewpoint: ViewpointGeometry): FlightTarget => {
    const { x, y } = viewpoint.epsg;
    const w = epsgToWorld(x, y, offset);
    return {
      pos: { x: w.x, y: groundAt(x, y) + viewpoint.aboveGround, z: w.z },
      headingDeg: viewpoint.headingDeg,
      pitchDeg: clampPitch(viewpoint.pitchDeg * DEG2RAD) * RAD2DEG,
      fov: viewpoint.fov,
    };
  };

  /** Eases the view towards the phone's aim by one step of `dt` seconds. */
  const followStep = (aim: FollowAim, dt: number) => {
    camera.getWorldDirection(dir);
    const now = headingPitchOf(dir);
    const t = 1 - Math.exp(-dt / FOLLOW_TAU);
    const heading = easeAngleDeg(now.heading * RAD2DEG, aim.headingDeg, t);
    const pitch = clampPitch(
      (now.pitch * RAD2DEG + (aim.pitchDeg - now.pitch * RAD2DEG) * t) * DEG2RAD
    );
    const d = directionOf(heading * DEG2RAD, pitch);
    camera.lookAt(
      camera.position.x + d.x,
      camera.position.y + d.y,
      camera.position.z + d.z
    );
  };

  /** Eases the camera towards the live position by one step. */
  const followPositionStep = (to: { x: number; z: number }, dt: number) => {
    const t = 1 - Math.exp(-dt / FOLLOW_POSITION_TAU);
    camera.position.x += (to.x - camera.position.x) * t;
    camera.position.z += (to.z - camera.position.z) * t;
  };

  /** The player took over by hand: live mode ends, the HUD hears of it. */
  const endFollow = () => {
    if (followAim || followPos) {
      followAim = null;
      followPos = null;
      opts.onFollowEnd?.();
    }
  };

  /** Yaw/pitch the view by radians; the player took the wheel. */
  const rotate = (yaw: number, pitch: number) => {
    cancelGlide();
    endFollow();
    euler.setFromQuaternion(camera.quaternion);
    euler.y += yaw;
    euler.x = clampPitch(euler.x + pitch);
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
  };

  return {
    getMode: movement.getMode,
    getPose,
    getCameraState: () => {
      camera.getWorldDirection(dir);
      const { heading, pitch } = headingPitchOf(dir);
      const epsg = worldToEpsg(camera.position.x, camera.position.z, offset);
      return {
        mode: movement.getMode(),
        pos: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        epsg: { x: epsg.x, y: epsg.y },
        headingDeg: heading * RAD2DEG,
        pitchDeg: pitch * RAD2DEG,
        fov: camera.fov,
      };
    },
    applyCameraState: (s) => {
      cancelGlide();
      // Fly first so the ground clamp doesn't yank an aerial pose down to eye
      // height before the frame even renders.
      settle(s.mode);
      camera.position.set(s.pos.x, s.pos.y, s.pos.z);
      const d = directionOf(
        s.headingDeg * DEG2RAD,
        clampPitch(s.pitchDeg * DEG2RAD)
      );
      camera.lookAt(
        camera.position.x + d.x,
        camera.position.y + d.y,
        camera.position.z + d.z
      );
      if (s.fov > 0) {
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
      }
      poseJumped();
    },
    teleportTo: (epsgX, epsgY) => {
      cancelGlide();
      const w = epsgToWorld(epsgX, epsgY, offset);
      camera.position.set(w.x, groundAt(epsgX, epsgY) + EYE_HEIGHT, w.z);
      // Level the view (keep the compass heading, drop pitch/roll) — after
      // an aerial pose the player would otherwise stare at the ground.
      euler.setFromQuaternion(camera.quaternion);
      euler.x = 0;
      euler.z = 0;
      camera.quaternion.setFromEuler(euler);
      poseJumped();
    },
    flyTo: (position, lookAt) => {
      cancelGlide();
      settle("fly");
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
      poseJumped();
    },
    captureViewpoint: () => {
      camera.getWorldDirection(dir);
      const { heading, pitch } = headingPitchOf(dir);
      const epsg = worldToEpsg(camera.position.x, camera.position.z, offset);
      return {
        epsg: { x: epsg.x, y: epsg.y },
        aboveGround: camera.position.y - groundAt(epsg.x, epsg.y),
        headingDeg: heading * RAD2DEG,
        pitchDeg: pitch * RAD2DEG,
        fov: camera.fov,
        mode: movement.getMode(),
      };
    },
    flyToViewpoint: (viewpoint) => {
      // Fly during the glide so the ground clamp can't fight the vertical arc;
      // pendingMode restores walk (and snaps to the ground) once it settles.
      settle("fly");
      flight.start(targetOf(viewpoint));
      pendingMode = viewpoint.mode;
    },
    placeAt: (viewpoint) => {
      cancelGlide();
      const target = targetOf(viewpoint);
      camera.position.set(target.pos.x, target.pos.y, target.pos.z);
      const d = directionOf(
        target.headingDeg * DEG2RAD,
        target.pitchDeg * DEG2RAD
      );
      camera.lookAt(
        camera.position.x + d.x,
        camera.position.y + d.y,
        camera.position.z + d.z
      );
      camera.fov = target.fov;
      camera.updateProjectionMatrix();
      settle(viewpoint.mode);
      poseJumped();
    },
    cancelGlide,
    step: (dt) => {
      // A scenic flight, while active, owns the camera — player movement is
      // suspended so input can't tug against the tween.
      if (flight.update(dt)) {
        return;
      }
      if (pendingMode) {
        settle(pendingMode);
        pendingMode = null;
      }
      if (followAim) {
        followStep(followAim, dt);
      }
      if (followPos) {
        followPositionStep(followPos, dt);
      }
      movement.update(dt);
    },
    setMovementMode,
    setFollowAim: (aim) => {
      followAim = aim;
    },
    setFollowPosition: (epsg) => {
      if (!epsg) {
        followPos = null;
        return;
      }
      const w = epsgToWorld(epsg.x, epsg.y, offset);
      followPos = { x: w.x, z: w.z };
      const far =
        Math.hypot(w.x - camera.position.x, w.z - camera.position.z) >
        FOLLOW_SNAP_M;
      if (far) {
        camera.position.x = w.x;
        camera.position.z = w.z;
        if (movement.getMode() === "walk") {
          movement.snapToGround();
        }
        poseJumped();
      }
    },
    toggleMode: () =>
      setMovementMode(movement.getMode() === "walk" ? "fly" : "walk"),
    press: (code) => {
      if (MOVEMENT_KEYS.has(code)) {
        cancelGlide();
        endFollow();
        movement.press(code);
      }
    },
    release: movement.release,
    releaseAll: movement.releaseAll,
    setClimbInput: (v) => {
      // Altitude is the one thing live mode leaves to the player: climbing
      // or sinking keeps it following (a drone over your GPS position).
      if (v !== 0) {
        cancelGlide();
      }
      movement.setVertical(v);
    },
    setMoveInput: (x, y) => {
      if (x !== 0 || y !== 0) {
        cancelGlide();
        endFollow();
      }
      movement.setAnalog(x, y);
    },
    // "Grab the world": dragging right rotates the view left.
    turn: (dxPx, dyPx) =>
      rotate(dxPx * GRAB_RADIANS_PER_PX, dyPx * GRAB_RADIANS_PER_PX),
    look: (dxPx, dyPx) =>
      rotate(-dxPx * MOUSE_RADIANS_PER_PX, -dyPx * MOUSE_RADIANS_PER_PX),
    beginZoom: () => {
      zoomStartFov = camera.fov;
    },
    zoomTo: (ratio) => setFov(nextFov(zoomStartFov, ratio)),
    zoomBy: (ratio) => setFov(nextFov(camera.fov, ratio)),
  };
}
