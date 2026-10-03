import { type Camera, Euler, type PerspectiveCamera } from "three/webgpu";
import {
  dollyFrame,
  enteringView,
  equivalentDistance,
  isLevelView,
  leavingPose,
  MODEL_PRESET_BY_ID,
  MODEL_SCALE_MAX,
  MODEL_STANDOFF,
  type ModelPresetId,
  type ModelView,
  metresPerPixelOf,
  modelCameraGeometry,
  modelFootprint,
  panned,
  type PerspectivePose,
  RETURN_RADIUS_M,
  scaleOf,
  snapTilt,
  snapTurn,
  viewBetween,
  withPreset,
  wrapDeg,
  zoomedAbout,
} from "@/lib/city/model-view";
import {
  type CameraState,
  DEG2RAD,
  directionOf,
  headingPitchOf,
  RAD2DEG,
  type Xyz,
} from "@/lib/city/pose";
import type { ModelStateJson } from "@/lib/city/snapshot";
import { clamp } from "@/lib/city/math";
import { ModelCamera } from "./model-camera";
import type { MovementMode } from "./fps-movement";

/** walk and fly, and Modell (plan 055). */
export type ViewMode = MovementMode | "model";

/** What the HUD shows of a Modell view. */
export interface ModelHud {
  preset: ModelPresetId;
  /** compass heading the view looks along */
  turnDeg: number;
  tiltDeg: number;
  /** the scale denominator at 96 dpi */
  scale: number;
  metresPerPixel: number;
  shear: number;
  /** the pivot, and the ground the picture shows (EPSG via the caller) */
  pivot: Xyz;
  footprint: Xyz[];
  /** in the middle of the glide in or out */
  transitioning: boolean;
  /** an Ausschnitt is set (model-cuts.ts; the scene fills it in) */
  cutOut: boolean;
}

/** s the dolly zoom in and out takes. */
const ENTER_S = 1.1;
const LEAVE_S = 1.0;
/** s a preset switch, a turn or a re-centring glides. */
const SWITCH_S = 0.7;
const TURN_S = 0.35;
const CENTRE_S = 0.6;
const SCALE_S = 0.35;
/** CSS px a held key pans per second (Shift: × PAN_FAST). */
const PAN_PX_PER_S = 520;
const PAN_FAST = 2.5;
/** deg per CSS px of a turn drag, and of a tilt drag. */
const TURN_DEG_PER_PX = 0.3;
const TILT_DEG_PER_PX = 0.25;
/** A turn drag snaps to this on release. */
const TURN_SNAP_DEG = 15;
/** One + / − key: the scale by this factor. */
const KEY_ZOOM = Math.SQRT2;
/** A walker's Modell centres this far ahead (the view axis meets no ground). */
const WALK_AHEAD_M = 150;
/** The walk/fly camera's frustum, restored after the dolly zoom. */
const PERSPECTIVE_NEAR = 0.3;
const PERSPECTIVE_FAR = 6000;

const PAN_KEYS: Readonly<Record<string, [number, number]>> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const ZOOM_IN_KEYS = new Set(["Equal", "NumpadAdd", "BracketRight"]);
const ZOOM_OUT_KEYS = new Set(["Minus", "NumpadSubtract", "Slash"]);

export interface ModelRigOptions {
  /** the walk/fly camera: the dolly zoom moves it */
  camera: PerspectiveCamera;
  /** the perspective pose's owner (camera-pose.ts) */
  pose: {
    applyCameraState: (state: CameraState) => void;
    cancelGlide: () => void;
    getCameraState: () => CameraState;
    setMovementMode: (mode: MovementMode) => void;
  };
  /** ground elevation (world Y) under world (x, z) */
  groundAt: (x: number, z: number) => number;
  /** distance along a ray to the ground, or null within `far` */
  groundAlong: (origin: Xyz, direction: Xyz, far: number) => number | null;
  /** the canvas in CSS px */
  viewport: () => { height: number; width: number };
  /** the site's world rectangle (minX, minZ, maxX, maxZ): the pivot stays on it */
  bounds: [number, number, number, number];
  /** the widest scale the device may show (a phone's memory) */
  maxScale?: number;
  /**
   * The camera the frame draws with changed hands: true when Modell's
   * parallel camera takes over (the dolly zoom has landed), false when the
   * walk/fly camera does (the dolly zoom out starts).
   */
  onSwap: (parallel: boolean) => void;
  /** The view mode changed (at the start of a glide, as the HUD follows the press). */
  onModeChange: (mode: ViewMode) => void;
}

type Phase =
  | { kind: "off" }
  | {
      kind: "entering";
      from: PerspectivePose;
      lookDistance: number;
      t: number;
    }
  | { kind: "model" }
  | {
      kind: "leaving";
      to: PerspectivePose & { lookDistance: number };
      mode: MovementMode;
      /** lands in fly, then walks down (a walker far from where it entered) */
      thenLand: boolean;
      t: number;
    };

interface Glide {
  from: ModelView;
  to: ModelView;
  t: number;
  duration: number;
}

export interface ModelRig {
  readonly camera: ModelCamera;
  /** Modell owns the frame: the dolly zooms and the parallel view. */
  owns: () => boolean;
  /** the parallel camera draws (not in a dolly zoom) */
  parallel: () => boolean;
  /** the camera the frame is drawn with */
  current: () => Camera;
  /** the view as it stands (also mid-glide), or null outside Modell */
  view: () => ModelView | null;
  /** the view a dolly zoom is heading to or coming from */
  targetView: () => ModelView | null;
  /** the dolly zoom's progress towards the parallel view (0 = perspective) */
  blend: () => number;
  /** Enters Modell from the walk/fly view, in `preset` (the last one by default). */
  enter: (preset?: ModelPresetId) => void;
  /** Leaves Modell for walk or fly (the pose it was entered from, if near). */
  leave: (mode?: MovementMode) => void;
  setPreset: (preset: ModelPresetId) => void;
  setScale: (denominator: number) => void;
  /** Turns by `deg` (Q/E, the rotate buttons), gliding. */
  turnBy: (deg: number) => void;
  /** Turns to a compass heading (north up = 0), gliding. */
  turnTo: (deg: number) => void;
  /** Vogelschau's tilt (degrees below the horizon). */
  setTilt: (deg: number) => void;
  /** the Militärperspektive's heights (1 = full, ⅔ …) */
  setShear: (k: number) => void;
  /** Centres the picture on a world point, gliding. */
  centreOn: (point: Xyz) => void;
  /** a drag of the ground (CSS px, y down) */
  pan: (dxPx: number, dyPx: number) => void;
  /** a turn drag (right button, two fingers twisting); `tilt` with Shift */
  rotateDrag: (dxPx: number, dyPx: number, tilt: boolean) => void;
  /** a two-finger twist, radians (counter-clockwise on screen) */
  twist: (radians: number) => void;
  /** a turn or tilt drag ended: snap */
  endDrag: () => void;
  /** zoom about a screen point (NDC) by `factor` (> 1 zooms in) */
  zoomAt: (ndc: { x: number; y: number }, factor: number) => void;
  press: (code: string) => void;
  release: (code: string) => void;
  releaseAll: () => void;
  /** Advances the glides and the held keys by `dt` s. */
  step: (dt: number) => void;
  /** The view for the HUD, or null outside Modell. */
  hud: () => ModelHud | null;
  /** the view as a snapshot member, or null outside Modell */
  state: () => ModelStateJson | null;
  /**
   * The perspective pose Modell would leave to (a snapshot's camera fields
   * while in Modell: what a reader that predates Modell shows), or null.
   */
  perspectiveState: () => CameraState | null;
  /** Puts a snapshot's view up at once (no dolly zoom). */
  applyState: (state: ModelStateJson) => void;
  /** Leaves Modell at once (a perspective snapshot was applied). */
  exitNow: () => void;
  /** the distance the far-field looks read, or null outside Modell */
  equivalentDistance: () => number | null;
  /** The canvas changed size: the frustum follows. */
  resize: () => void;
}

const euler = new Euler(0, 0, 0, "YXZ");

/** Aims the perspective camera by a compass heading and pitch (degrees). */
function aim(
  camera: PerspectiveCamera,
  headingDeg: number,
  pitchDeg: number
): void {
  // YXZ: yaw first, then pitch — straight down is fine, no lookAt.
  euler.set(pitchDeg * DEG2RAD, -headingDeg * DEG2RAD, 0, "YXZ");
  camera.quaternion.setFromEuler(euler);
}

/**
 * Modell's rig (plan 055): owns the parallel camera — the view as pivot,
 * turn, tilt and scale (lib/city/model-view.ts) — and the dolly zooms in
 * from and out to the walk/fly camera. Every input goes through here while
 * Modell owns the frame, as every input goes through camera-pose.ts
 * otherwise; any input cancels a glide.
 */
export function createModelRig(opts: ModelRigOptions): ModelRig {
  const camera = new ModelCamera();
  const maxScale = opts.maxScale ?? MODEL_SCALE_MAX;
  let phase: Phase = { kind: "off" };
  let view: ModelView | null = null;
  let glide: Glide | null = null;
  let lastPreset: ModelPresetId = "iso";
  /** where Modell was entered from, and the pivot it entered on */
  let entry: { state: CameraState; pivot: Xyz } | null = null;
  const keys = new Set<string>();
  let fast = false;
  let dragging = false;
  let dirty = true;

  const viewport = () => {
    const v = opts.viewport();
    return { width: Math.max(v.width, 1), height: Math.max(v.height, 1) };
  };

  /** the pivot kept on the site (a little beyond its edge) */
  const onSite = (p: Xyz): Xyz => {
    const [x0, z0, x1, z1] = opts.bounds;
    const margin = 500;
    return {
      x: clamp(p.x, x0 - margin, x1 + margin),
      y: p.y,
      z: clamp(p.z, z0 - margin, z1 + margin),
    };
  };

  /** the pivot set down on the ground (a level view keeps its height) */
  const grounded = (v: ModelView): ModelView => {
    if (isLevelView(v)) {
      return v;
    }
    const p = onSite(v.pivot);
    return { ...v, pivot: { ...p, y: opts.groundAt(p.x, p.z) } };
  };

  const placeCamera = () => {
    if (!view) {
      return;
    }
    camera.setGeometry(modelCameraGeometry(view, viewport()), MODEL_STANDOFF);
    dirty = false;
  };

  const setView = (next: ModelView) => {
    view = { ...next, pivot: onSite(next.pivot) };
    dirty = true;
  };

  const glideTo = (to: ModelView, duration: number) => {
    if (!view) {
      return;
    }
    glide = { from: view, to, t: 0, duration };
  };

  const cancelGlide = () => {
    if (glide) {
      setView(glide.to);
      glide = null;
    }
  };

  const perspectivePose = (): PerspectivePose => {
    const s = opts.pose.getCameraState();
    return {
      position: { ...s.pos },
      headingDeg: s.headingDeg,
      pitchDeg: s.pitchDeg,
      fovDeg: s.fov,
    };
  };

  /** Where the walk/fly view looks: its axis on the ground, else ahead. */
  const lookedAt = (pose: PerspectivePose): Xyz => {
    const dir = directionOf(pose.headingDeg * DEG2RAD, pose.pitchDeg * DEG2RAD);
    const hit = opts.groundAlong(pose.position, dir, 4000);
    if (hit !== null) {
      return {
        x: pose.position.x + dir.x * hit,
        y: pose.position.y + dir.y * hit,
        z: pose.position.z + dir.z * hit,
      };
    }
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const x = pose.position.x + (dir.x / flat) * WALK_AHEAD_M;
    const z = pose.position.z + (dir.z / flat) * WALK_AHEAD_M;
    return { x, y: opts.groundAt(x, z), z };
  };

  const applyFrame = (
    pose: PerspectivePose,
    lookDistance: number,
    to: ModelView,
    t: number
  ) => {
    const f = dollyFrame(pose, lookDistance, to, viewport().height, t);
    const c = opts.camera;
    c.position.set(f.position.x, f.position.y, f.position.z);
    aim(c, f.headingDeg, f.pitchDeg);
    c.fov = f.fovDeg;
    c.near = f.near;
    c.far = f.far;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  };

  const restorePerspective = () => {
    const c = opts.camera;
    c.near = PERSPECTIVE_NEAR;
    c.far = PERSPECTIVE_FAR;
    c.updateProjectionMatrix();
  };

  const enter = (preset: ModelPresetId = lastPreset) => {
    if (phase.kind === "model" || phase.kind === "entering") {
      return;
    }
    if (phase.kind === "leaving" && view) {
      // turned back mid-way: on from where the zoom out stands
      phase = {
        kind: "entering",
        from: phase.to,
        lookDistance: phase.to.lookDistance,
        t: phase.t,
      };
      opts.onModeChange("model");
      return;
    }
    opts.pose.cancelGlide();
    const from = perspectivePose();
    const pivot = lookedAt(from);
    entry = { state: opts.pose.getCameraState(), pivot };
    lastPreset = preset;
    setView(enteringView(from, pivot, preset, viewport().height, maxScale));
    const lookDistance = Math.hypot(
      pivot.x - from.position.x,
      pivot.y - from.position.y,
      pivot.z - from.position.z
    );
    phase = { kind: "entering", from, lookDistance, t: 0 };
    opts.onModeChange("model");
  };

  /** Where leaving would land: back where Modell was entered, if near. */
  const leaveTarget = (
    v: ModelView
  ): {
    to: PerspectivePose & { lookDistance: number };
    mode: MovementMode;
  } => {
    const near =
      entry &&
      Math.hypot(v.pivot.x - entry.pivot.x, v.pivot.z - entry.pivot.z) <=
        RETURN_RADIUS_M;
    const backTo = near && entry ? entry.state : null;
    if (backTo) {
      return {
        to: {
          position: { ...backTo.pos },
          headingDeg: backTo.headingDeg,
          pitchDeg: backTo.pitchDeg,
          fovDeg: backTo.fov,
          lookDistance: Math.max(
            Math.hypot(
              v.pivot.x - backTo.pos.x,
              v.pivot.y - backTo.pos.y,
              v.pivot.z - backTo.pos.z
            ),
            1
          ),
        },
        mode: backTo.mode,
      };
    }
    return {
      to: leavingPose(v, viewport().height, entry?.state.fov ?? 55),
      mode: "fly",
    };
  };

  const leave = (mode?: MovementMode) => {
    if (!view || phase.kind === "off" || phase.kind === "leaving") {
      return;
    }
    cancelGlide();
    keys.clear();
    const target = leaveTarget(view);
    const t = phase.kind === "entering" ? phase.t : 1;
    if (phase.kind === "model") {
      opts.onSwap(false);
    }
    const wanted = mode ?? target.mode;
    // a vantage is in the air: a walker lands from there, as F would
    const thenLand = wanted === "walk" && target.mode === "fly";
    phase = {
      kind: "leaving",
      to: target.to,
      mode: thenLand ? "fly" : wanted,
      thenLand,
      t,
    };
    opts.onModeChange(wanted);
  };

  const finishLeaving = (
    to: PerspectivePose,
    mode: MovementMode,
    thenLand: boolean
  ) => {
    restorePerspective();
    const dir = directionOf(to.headingDeg * DEG2RAD, to.pitchDeg * DEG2RAD);
    const { heading, pitch } = headingPitchOf(dir);
    opts.pose.applyCameraState({
      mode,
      pos: { ...to.position },
      epsg: { x: 0, y: 0 },
      headingDeg: heading * RAD2DEG,
      pitchDeg: pitch * RAD2DEG,
      fov: to.fovDeg,
    });
    phase = { kind: "off" };
    view = null;
    entry = null;
    if (thenLand) {
      opts.pose.setMovementMode("walk");
    }
  };

  const stepGlide = (dt: number) => {
    if (!glide) {
      return;
    }
    glide.t = Math.min(glide.t + dt / glide.duration, 1);
    setView(viewBetween(glide.from, glide.to, glide.t));
    if (glide.t >= 1) {
      glide = null;
    }
  };

  const stepKeys = (dt: number) => {
    if (!view || keys.size === 0) {
      return;
    }
    let dx = 0;
    let dy = 0;
    for (const k of keys) {
      const d = PAN_KEYS[k];
      if (d) {
        dx += d[0];
        dy += d[1];
      }
    }
    if (dx === 0 && dy === 0) {
      return;
    }
    const len = Math.hypot(dx, dy);
    const px = PAN_PX_PER_S * dt * (fast ? PAN_FAST : 1);
    // the keys move the view; the ground goes the other way under it
    setView(
      grounded({
        ...view,
        pivot: panned(view, (-dx / len) * px, (-dy / len) * px),
      })
    );
  };

  const hud = (): ModelHud | null => {
    const v = view;
    if (!v) {
      return null;
    }
    return {
      preset: v.preset,
      turnDeg: v.turnDeg,
      tiltDeg: v.tiltDeg,
      scale: scaleOf(v.metresPerPixel),
      metresPerPixel: v.metresPerPixel,
      shear: v.shear,
      pivot: v.pivot,
      footprint: modelFootprint(v, viewport()),
      transitioning: phase.kind === "entering" || phase.kind === "leaving",
      cutOut: false,
    };
  };

  const takeInput = () => {
    if (phase.kind !== "model" || !view) {
      return false;
    }
    cancelGlide();
    return true;
  };

  return {
    camera,
    owns: () => phase.kind !== "off",
    parallel: () => phase.kind === "model",
    current: () => (phase.kind === "model" ? camera : opts.camera),
    view: () => (phase.kind === "model" ? view : null),
    targetView: () => view,
    blend: () => {
      switch (phase.kind) {
        case "off":
          return 0;
        case "model":
          return 1;
        case "entering":
        case "leaving":
          return phase.t;
      }
    },
    enter,
    leave,
    setPreset: (preset) => {
      if (!view) {
        enter(preset);
        return;
      }
      cancelGlide();
      lastPreset = preset;
      const next = withPreset(view, preset);
      const wasLevel = isLevelView(view);
      const toLevel = MODEL_PRESET_BY_ID[preset].cut;
      // a level view's pivot is the cut's middle, a little above the ground
      const pivot =
        toLevel && !wasLevel
          ? { ...view.pivot, y: opts.groundAt(view.pivot.x, view.pivot.z) }
          : view.pivot;
      const to = toLevel ? { ...next, pivot } : grounded(next);
      if (phase.kind === "model") {
        glideTo(to, SWITCH_S);
      } else {
        setView(to);
      }
    },
    setScale: (denominator) => {
      if (!takeInput() || !view) {
        return;
      }
      const z = zoomedAbout(
        view,
        viewport(),
        { x: 0, y: MODEL_PRESET_BY_ID[view.preset].pivotNdcY },
        view.metresPerPixel / metresPerPixelOf(denominator),
        maxScale
      );
      glideTo({ ...view, ...z }, SCALE_S);
    },
    turnBy: (deg) => {
      if (!takeInput() || !view) {
        return;
      }
      glideTo({ ...view, turnDeg: wrapDeg(view.turnDeg + deg) }, TURN_S);
    },
    turnTo: (deg) => {
      if (!takeInput() || !view) {
        return;
      }
      glideTo({ ...view, turnDeg: wrapDeg(deg) }, TURN_S);
    },
    setTilt: (deg) => {
      if (!takeInput() || !view) {
        return;
      }
      const base = view.preset === "bird" ? view : withPreset(view, "bird");
      setView(grounded({ ...base, tiltDeg: clamp(deg, 5, 90) }));
    },
    setShear: (k) => {
      if (!takeInput() || view?.preset !== "military") {
        return;
      }
      glideTo({ ...view, shear: clamp(k, 0.3, 1.5) }, SCALE_S);
    },
    centreOn: (point) => {
      if (!view) {
        return;
      }
      cancelGlide();
      const to = grounded({ ...view, pivot: { ...point } });
      if (phase.kind === "model") {
        glideTo(to, CENTRE_S);
      } else {
        setView(to);
      }
    },
    pan: (dxPx, dyPx) => {
      if (!takeInput() || !view) {
        return;
      }
      setView(grounded({ ...view, pivot: panned(view, dxPx, dyPx) }));
    },
    rotateDrag: (dxPx, dyPx, tilt) => {
      if (!takeInput() || !view) {
        return;
      }
      dragging = true;
      if (tilt) {
        const base = view.preset === "bird" ? view : withPreset(view, "bird");
        setView(
          grounded({
            ...base,
            turnDeg: view.turnDeg,
            tiltDeg: clamp(view.tiltDeg - dyPx * TILT_DEG_PER_PX, 5, 90),
          })
        );
        return;
      }
      setView({
        ...view,
        turnDeg: wrapDeg(view.turnDeg - dxPx * TURN_DEG_PER_PX),
      });
    },
    twist: (radians) => {
      if (!takeInput() || !view) {
        return;
      }
      dragging = true;
      setView({ ...view, turnDeg: wrapDeg(view.turnDeg - radians * RAD2DEG) });
    },
    endDrag: () => {
      if (!dragging || !view || phase.kind !== "model") {
        dragging = false;
        return;
      }
      dragging = false;
      glideTo(
        grounded({
          ...view,
          turnDeg: snapTurn(view.turnDeg, 0, TURN_SNAP_DEG),
          tiltDeg:
            view.preset === "bird" ? snapTilt(view.tiltDeg) : view.tiltDeg,
        }),
        TURN_S
      );
    },
    zoomAt: (ndc, factor) => {
      if (!takeInput() || !view) {
        return;
      }
      setView(
        grounded({
          ...view,
          ...zoomedAbout(view, viewport(), ndc, factor, maxScale),
        })
      );
    },
    press: (code) => {
      if (phase.kind !== "model" || !view) {
        return;
      }
      if (code === "ShiftLeft" || code === "ShiftRight") {
        fast = true;
        return;
      }
      if (PAN_KEYS[code]) {
        cancelGlide();
        keys.add(code);
        return;
      }
      const centre = { x: 0, y: MODEL_PRESET_BY_ID[view.preset].pivotNdcY };
      if (code === "KeyQ" || code === "KeyE") {
        cancelGlide();
        glideTo(
          {
            ...view,
            turnDeg: wrapDeg(view.turnDeg + (code === "KeyQ" ? -90 : 90)),
          },
          TURN_S
        );
      } else if (ZOOM_IN_KEYS.has(code) || ZOOM_OUT_KEYS.has(code)) {
        cancelGlide();
        const factor = ZOOM_IN_KEYS.has(code) ? KEY_ZOOM : 1 / KEY_ZOOM;
        glideTo(
          grounded({
            ...view,
            ...zoomedAbout(view, viewport(), centre, factor, maxScale),
          }),
          SCALE_S
        );
      }
    },
    release: (code) => {
      if (code === "ShiftLeft" || code === "ShiftRight") {
        fast = false;
      }
      keys.delete(code);
    },
    releaseAll: () => {
      keys.clear();
      fast = false;
    },
    step: (dt) => {
      switch (phase.kind) {
        case "off":
          return;
        case "entering": {
          phase.t = Math.min(phase.t + dt / ENTER_S, 1);
          if (view) {
            applyFrame(phase.from, phase.lookDistance, view, phase.t);
          }
          if (phase.t >= 1) {
            phase = { kind: "model" };
            placeCamera();
            opts.onSwap(true);
          }
          return;
        }
        case "leaving": {
          phase.t = Math.max(phase.t - dt / LEAVE_S, 0);
          if (view) {
            applyFrame(phase.to, phase.to.lookDistance, view, phase.t);
          }
          if (phase.t <= 0) {
            finishLeaving(phase.to, phase.mode, phase.thenLand);
          }
          return;
        }
        case "model":
          stepGlide(dt);
          stepKeys(dt);
          if (dirty) {
            placeCamera();
          }
      }
    },
    hud,
    state: () => {
      const v = phase.kind === "off" ? null : view;
      if (!v) {
        return null;
      }
      return {
        pivot: { ...v.pivot },
        preset: v.preset,
        scale: scaleOf(v.metresPerPixel),
        tiltDeg: v.tiltDeg,
        turnDeg: v.turnDeg,
        shear: v.shear,
      };
    },
    perspectiveState: () => {
      if (!view || phase.kind === "off") {
        return null;
      }
      const { to, mode } = leaveTarget(view);
      return {
        mode,
        pos: { ...to.position },
        epsg: { x: 0, y: 0 },
        headingDeg: wrapDeg(to.headingDeg),
        pitchDeg: to.pitchDeg,
        fov: to.fovDeg,
      };
    },
    applyState: (s) => {
      const preset = MODEL_PRESET_BY_ID[s.preset];
      glide = null;
      if (phase.kind === "off") {
        entry = null;
      }
      lastPreset = s.preset;
      setView({
        pivot: { ...s.pivot },
        preset: s.preset,
        turnDeg: wrapDeg(s.turnDeg),
        tiltDeg: clamp(s.tiltDeg, 0, 90),
        metresPerPixel: metresPerPixelOf(s.scale),
        shear: s.shear ?? preset.shear,
        cut: preset.cut,
      });
      const was = phase.kind;
      phase = { kind: "model" };
      placeCamera();
      if (was !== "model") {
        opts.onSwap(true);
        opts.onModeChange("model");
      }
    },
    exitNow: () => {
      if (phase.kind === "off") {
        return;
      }
      const wasParallel = phase.kind === "model";
      restorePerspective();
      phase = { kind: "off" };
      view = null;
      glide = null;
      entry = null;
      keys.clear();
      if (wasParallel) {
        opts.onSwap(false);
      }
    },
    equivalentDistance: () => {
      if (!view || phase.kind === "off") {
        return null;
      }
      const vp = viewport();
      if (phase.kind === "model") {
        return equivalentDistance(view.metresPerPixel, vp.height);
      }
      // mid-zoom: the picture's height at the point looked at
      const pose = phase.kind === "entering" ? phase.from : phase.to;
      const lookDistance =
        phase.kind === "entering" ? phase.lookDistance : phase.to.lookDistance;
      const f = dollyFrame(pose, lookDistance, view, vp.height, phase.t);
      const height = 2 * f.distance * Math.tan((f.fovDeg * DEG2RAD) / 2);
      return equivalentDistance(height / vp.height, vp.height);
    },
    resize: () => {
      dirty = true;
      if (phase.kind === "model") {
        placeCamera();
      }
    },
  };
}
