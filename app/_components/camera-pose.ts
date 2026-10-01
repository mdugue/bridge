import { Euler, type PerspectiveCamera, Vector3 } from "three/webgpu";
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
import {
  clearHeight,
  GROUND_CLEARANCE,
  nearestFree,
  ROOF_CLEARANCE,
} from "@/lib/city/clearance";
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

/**
 * m above the ground where a walker's knees are: a shed lower than the eye
 * still counts as standing in it.
 */
const KNEE_HEIGHT = 0.5;

/** The buildings, as the clearance guard asks after them (collision.ts). */
export interface CameraSolids {
  /** inside a building at world (x, y, z): the roof's height above, else null */
  roofAbove: (x: number, y: number, z: number) => number | null;
  /** the highest building surface over world (x, z), or null */
  topAt: (x: number, z: number) => number | null;
}

/** rad per CSS px of grab-look drag — a full phone-width swipe ≈ 90° */
const GRAB_RADIANS_PER_PX = 0.004;
/** rad per CSS px of pointer-locked mouse motion (half the grab speed). */
const MOUSE_RADIANS_PER_PX = 0.002;

/**
 * Dolly (pinch, wheel): m per unit of ln(finger-distance ratio) — spreading
 * the fingers to twice their distance walks about 10 m on foot…
 */
const WALK_DOLLY_M = 14;
/**
 * …and in the air covers this share of the height above the ground per
 * unit, so a pinch feels the same from the rooftops as from high above.
 */
const FLY_DOLLY_PER_M = 0.9;
const FLY_DOLLY_MIN_M = 15;

/** m above the ground a take-off (walk → fly) rises to. */
const TAKEOFF_HEIGHT = 30;
/** s the take-off takes. */
const TAKEOFF_DURATION = 1.1;
/** deg — taking off, the view tips this far down at least, onto the street. */
const TAKEOFF_PITCH_DEG = -12;
/** s — a landing (fly → walk): this, plus LANDING_S_PER_SQRT_M · √drop… */
const LANDING_BASE = 0.35;
const LANDING_S_PER_SQRT_M = 0.12;
/** …at most (s): even from 1 km up the landing is a breath, not a wait. */
const LANDING_MAX = 2.2;

/** A double-tap glide: s, plus TRAVEL_S_PER_M per metre… */
const TRAVEL_BASE = 0.6;
const TRAVEL_S_PER_M = 0.004;
const TRAVEL_MIN = 0.8;
const TRAVEL_MAX = 2.6;
/** …bowing up by this share of the distance on foot (a hop, not a flight). */
const TRAVEL_ARC_RATIO = 0.06;
const TRAVEL_MAX_ARC = 25;
/**
 * In the air a double tap flies this share of the way towards the tapped
 * spot, along the line of sight — the spot stays where it was on screen,
 * only nearer, like a map's double-tap zoom.
 */
const FLY_TRAVEL_SHARE = 0.6;

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
  /** wall collision for walking and flying (collision.ts) */
  resolveStep?: FpsMovementOptions["resolveStep"];
  /**
   * The buildings the camera must never end up inside; without them only
   * the ground bounds it.
   */
  solids?: CameraSolids;
}

export interface CameraPose {
  /** Restores a camera pose captured by getCameraState (snapshot replay). */
  applyCameraState: (state: CameraState) => void;
  /** Starts a pinch; pinchTo is relative to the finger distance here. */
  beginPinch: () => void;
  /** Drops a scenic glide in progress — the player took the wheel. */
  cancelGlide: () => void;
  /**
   * Moves the camera forward (> 0) or back by `amount` units of
   * ln(zoom ratio) — the pinch and the wheel. On foot it walks along the
   * ground; in the air it flies along the view, further the higher it is.
   */
  dolly: (amount: number) => void;
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
  /**
   * Double tap: glides to a world point — on foot to stand there, in the
   * air part of the way along the line of sight.
   */
  travelTo: (point: Xyz) => void;
  /** Pinch: `ratio` = finger distance / distance at beginPinch. */
  pinchTo: (ratio: number) => void;
  /** Wheel zoom (FOV): `ratio` > 1 zooms in, relative to the current FOV. */
  zoomBy: (ratio: number) => void;
}

/**
 * Owns the camera's pose: where the player stands, which way they look, walk
 * vs fly, and the scenic glides. Every way the pose can change goes through
 * here, which is what makes the one rule enforceable: **any player input
 * takes the wheel** — a movement key, the stick, a drag, a pinch or a mode
 * switch cancels a scenic glide instead of fighting it or being swallowed by
 * it. Poses set from outside (spawn, teleport, snapshot) do the same. The
 * player's own glides — a landing or take-off when the mode switches, a
 * double-tap trip — are the exception for a drag: it looks around while the
 * glide carries on, so a walker is never left hanging in mid-air.
 *
 * The other rule: **the camera is never below the ground or inside a
 * building** — not after a step, a glide frame (the glide plans its path
 * over what lies between), a teleport, a snapshot, a GPS fix, nor when a
 * tile lands around it. A walker is set out beside the building, anything
 * in the air lifted over its roof (lib/city/clearance.ts).
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
  /**
   * The glide is the player's own (a landing, a take-off, a double-tap
   * trip): a drag looks around in it rather than stopping it in mid-air.
   */
  let ownGlide = false;
  /** the pinch ratio the last dolly step was taken at */
  let lastPinch = 1;
  let followAim: FollowAim | null = null;
  /** world x/z the camera eases towards in live mode */
  let followPos: { x: number; z: number } | null = null;
  const dir = new Vector3();
  const euler = new Euler(0, 0, 0, "YXZ");

  const groundAt = (epsgX: number, epsgY: number): number =>
    opts.heightAt(epsgX, epsgY) ?? opts.groundFloor();
  const groundWorld = (x: number, z: number): number => {
    const epsg = worldToEpsg(x, z, offset);
    return groundAt(epsg.x, epsg.y);
  };
  const { solids } = opts;

  /**
   * A walker standing at world (x, z) is outside every building. Where no
   * terrain has landed yet the height to test at is unknown (the floor may
   * lie under a building's base): free until it lands.
   */
  const standsFree = (x: number, z: number): boolean => {
    const epsg = worldToEpsg(x, z, offset);
    const ground = opts.heightAt(epsg.x, epsg.y);
    if (!solids || ground === null) {
      return true;
    }
    return (
      solids.roofAbove(x, ground + KNEE_HEIGHT, z) === null &&
      solids.roofAbove(x, ground + EYE_HEIGHT, z) === null
    );
  };

  /**
   * `pos` with its x/z set out of the building it stands in (same height
   * above the ground), or null when there is no free spot near.
   */
  const standOutside = (pos: Xyz): Xyz | null => {
    const out = nearestFree(pos.x, pos.z, standsFree);
    if (!out) {
      return null;
    }
    if (out.x === pos.x && out.z === pos.z) {
      return pos;
    }
    const rise = groundWorld(out.x, out.z) - groundWorld(pos.x, pos.z);
    return { x: out.x, y: pos.y + rise, z: out.z };
  };

  /** `pos` lifted clear of the ground and out of any roof above it. */
  const liftClear = (pos: Xyz): Xyz => ({
    x: pos.x,
    y: clearHeight(
      pos.y,
      groundWorld(pos.x, pos.z),
      (y) => solids?.roofAbove(pos.x, y, pos.z) ?? null
    ),
    z: pos.z,
  });

  /**
   * Where `pos` is clear: a stander (`stand`) is set out beside the
   * building, then anything is lifted clear. `stand` comes back false when
   * nowhere near was free to stand — the pose has to fly.
   */
  const clearOf = (pos: Xyz, stand: boolean): { pos: Xyz; stand: boolean } => {
    const out = stand ? standOutside(pos) : null;
    return { pos: liftClear(out ?? pos), stand: stand && out !== null };
  };

  /** The lowest height a glide may pass at over world (x, z). */
  const glideFloor = (x: number, z: number): number =>
    Math.max(
      groundWorld(x, z) + GROUND_CLEARANCE,
      (solids?.topAt(x, z) ?? Number.NEGATIVE_INFINITY) + ROOF_CLEARANCE
    );

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
    ownGlide = false;
  };

  /** Mode change without touching the glide — the glide itself uses it. */
  const settle = (mode: MovementMode) => {
    movement.setMode(mode);
    if (mode === "walk") {
      movement.snapToGround();
    }
    opts.onModeChange?.(mode);
  };

  /**
   * Keeps the camera clear where it is now: a walker (`stand`) is set out
   * of a building, anything else lifted out of it and off the ground.
   * Nowhere near to stand, a walker takes off and hovers over the roof.
   */
  const keepClear = (stand: boolean) => {
    const p = camera.position;
    const clear = clearOf({ x: p.x, y: p.y, z: p.z }, stand);
    if (stand && !clear.stand && movement.getMode() === "walk") {
      settle("fly");
    }
    p.set(clear.pos.x, clear.pos.y, clear.pos.z);
  };

  /** The view's compass heading and pitch, in degrees. */
  const aimDeg = (): { headingDeg: number; pitchDeg: number } => {
    camera.getWorldDirection(dir);
    const { heading, pitch } = headingPitchOf(dir);
    return { headingDeg: heading * RAD2DEG, pitchDeg: pitch * RAD2DEG };
  };

  /** Starts one of the player's own glides (see ownGlide). */
  const glideTo = (
    target: FlightTarget,
    shape: { arc: number; duration: number }
  ) => {
    flight.start(target, glideFloor, shape);
    ownGlide = true;
  };

  /**
   * Fly → walk: glides down onto the ground below — beside a building
   * rather than on its roof — levelling the view, so the walker looks down
   * the street and not at their feet. Nowhere near to stand: hovers on.
   */
  const land = () => {
    const p = camera.position;
    const spot = standOutside({
      x: p.x,
      y: groundWorld(p.x, p.z) + EYE_HEIGHT,
      z: p.z,
    });
    if (!spot) {
      keepClear(true);
      return;
    }
    const pos = liftClear(spot);
    const drop = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z);
    glideTo(
      { pos, headingDeg: aimDeg().headingDeg, pitchDeg: 0, fov: camera.fov },
      {
        arc: 0,
        duration: Math.min(
          LANDING_BASE + LANDING_S_PER_SQRT_M * Math.sqrt(drop),
          LANDING_MAX
        ),
      }
    );
  };

  /**
   * Walk → fly: rises straight up to TAKEOFF_HEIGHT over the ground (and
   * any roof), tipping the view down onto the street — on a phone flying
   * would otherwise start at eye height with the altitude stick to climb.
   */
  const takeOff = () => {
    const p = camera.position;
    const y = Math.max(p.y, groundWorld(p.x, p.z) + TAKEOFF_HEIGHT);
    const pos = liftClear({ x: p.x, y, z: p.z });
    if (pos.y - p.y < 1) {
      keepClear(false);
      return;
    }
    const aim = aimDeg();
    glideTo(
      {
        pos,
        headingDeg: aim.headingDeg,
        pitchDeg: Math.min(aim.pitchDeg, TAKEOFF_PITCH_DEG),
        fov: camera.fov,
      },
      { arc: 0, duration: TAKEOFF_DURATION }
    );
  };

  /**
   * A switch between walking and flying is animated: a landing or a
   * take-off. The mode is the new one at once (the HUD follows the press);
   * the glide only carries the camera there.
   */
  const setMovementMode = (mode: MovementMode) => {
    const was = movement.getMode();
    cancelGlide();
    if (mode === was) {
      settle(mode);
      keepClear(mode === "walk");
      return;
    }
    movement.setMode(mode);
    opts.onModeChange?.(mode);
    if (mode === "walk") {
      land();
    } else {
      takeOff();
    }
  };

  const setFov = (fov: number) => {
    cancelGlide();
    camera.fov = fov;
    camera.updateProjectionMatrix();
  };

  /**
   * Where a viewpoint puts the camera, on the ground as it stands now and
   * clear of it — beside a building rather than in it on foot, over its
   * roof in the air.
   */
  const targetOf = (viewpoint: ViewpointGeometry): FlightTarget => {
    const { x, y } = viewpoint.epsg;
    const w = epsgToWorld(x, y, offset);
    const { pos } = clearOf(
      { x: w.x, y: groundAt(x, y) + viewpoint.aboveGround, z: w.z },
      viewpoint.mode === "walk"
    );
    return {
      pos,
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

  /**
   * Yaw/pitch the view by radians; the player took the wheel. Their own
   * glide (a landing, a double-tap trip) carries on and lets them look.
   */
  const rotate = (yaw: number, pitch: number) => {
    if (ownGlide) {
      flight.releaseLook();
    } else {
      cancelGlide();
    }
    endFollow();
    euler.setFromQuaternion(camera.quaternion);
    euler.y += yaw;
    euler.x = clampPitch(euler.x + pitch);
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
  };

  /** Pushes the camera along by `amount` units of ln(zoom ratio). */
  const dolly = (amount: number) => {
    if (amount === 0 || !Number.isFinite(amount)) {
      return;
    }
    cancelGlide();
    endFollow();
    const p = camera.position;
    const metres =
      movement.getMode() === "walk"
        ? WALK_DOLLY_M
        : Math.max(
            FLY_DOLLY_MIN_M,
            (p.y - groundWorld(p.x, p.z)) * FLY_DOLLY_PER_M
          );
    movement.dolly(amount * metres);
  };

  const travelTo = (point: Xyz) => {
    cancelGlide();
    endFollow();
    const p = camera.position;
    const aim = aimDeg();
    const walking = movement.getMode() === "walk";
    const pos = walking
      ? clearOf(
          {
            x: point.x,
            y: groundWorld(point.x, point.z) + EYE_HEIGHT,
            z: point.z,
          },
          true
        ).pos
      : liftClear({
          x: p.x + (point.x - p.x) * FLY_TRAVEL_SHARE,
          y: p.y + (point.y - p.y) * FLY_TRAVEL_SHARE,
          z: p.z + (point.z - p.z) * FLY_TRAVEL_SHARE,
        });
    const dist = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z);
    glideTo(
      {
        pos,
        headingDeg: aim.headingDeg,
        // On foot the trip ends looking ahead; in the air the aim holds, so
        // the tapped spot stays put on screen.
        pitchDeg: walking ? 0 : aim.pitchDeg,
        fov: camera.fov,
      },
      {
        arc: walking ? Math.min(dist * TRAVEL_ARC_RATIO, TRAVEL_MAX_ARC) : 0,
        duration: Math.min(
          Math.max(TRAVEL_BASE + dist * TRAVEL_S_PER_M, TRAVEL_MIN),
          TRAVEL_MAX
        ),
      }
    );
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
      keepClear(s.mode === "walk");
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
      // A teleport stands the player there, whichever the mode.
      keepClear(true);
      poseJumped();
    },
    flyTo: (position, lookAt) => {
      cancelGlide();
      settle("fly");
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
      keepClear(false);
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
      flight.start(targetOf(viewpoint), glideFloor);
      pendingMode = viewpoint.mode;
      ownGlide = false;
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
      keepClear(viewpoint.mode === "walk");
      poseJumped();
    },
    cancelGlide,
    step: (dt) => {
      // A scenic flight, while active, owns the camera — player movement is
      // suspended so input can't tug against the tween. Its path is planned
      // over what it knew at the start; a tile that landed since is caught
      // here, frame by frame.
      if (flight.update(dt)) {
        keepClear(false);
        return;
      }
      ownGlide = false;
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
      // Also catches the world changing under a still camera: a finer
      // terrain or a building tile landing where the player stands.
      keepClear(movement.getMode() === "walk");
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
      const at = epsgToWorld(epsg.x, epsg.y, offset);
      // A fix indoors (at home, in a shop) follows to the door, not inside.
      const w =
        movement.getMode() === "walk"
          ? (standOutside({ x: at.x, y: 0, z: at.z }) ?? { x: at.x, z: at.z })
          : at;
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
        keepClear(movement.getMode() === "walk");
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
    beginPinch: () => {
      lastPinch = 1;
    },
    pinchTo: (ratio) => {
      if (ratio > 0 && Number.isFinite(ratio)) {
        dolly(Math.log(ratio / lastPinch));
        lastPinch = ratio;
      }
    },
    dolly,
    travelTo,
    zoomBy: (ratio) => setFov(nextFov(camera.fov, ratio)),
  };
}
