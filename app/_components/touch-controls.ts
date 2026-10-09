import { isDoubleTap, type TapSample } from "@/lib/city/touch";

/**
 * Street-view-style canvas gestures via Pointer Events, for touch AND mouse:
 *  - one-pointer drag: look around ("grab the world")
 *  - two-finger pinch: move forward (spread) or back (pinch) — touch only;
 *    the fingers' midpoint comes along, and their twist (`onTwist`)
 *  - a right-button drag, or Ctrl/⌘ + drag (`onAltDrag`, Shift held or not):
 *    Modell turns (and tilts) by it; `onDragEnd` when it, or a two-finger
 *    gesture, ends
 *  - mouse wheel / trackpad pinch (Safari's gesture events too): the same;
 *    with Alt, zoom (FOV); the pointer's NDC comes along — the move heads
 *    for what is under the pointer, as a map zooms about the cursor
 *  - the mouse cursor is a hand: open over the canvas, closed while it
 *    drags (the grab convention of maps and Street View)
 *  - double-tap / double-click: travel to the tapped spot
 *  - a single tap / click: `onTap`, with the pointer's type (a click asks
 *    what is there; the first tap of a double one fires it too)
 *  - a long press (one finger or pen held still for LONG_PRESS_MS):
 *    `onLongPress` — asks what is there; the release after it is no tap.
 *    Not for the mouse: a desktop drag often starts with a pause, and the
 *    desktop asks by a click.
 *  - pointer lock (immersive mode, opt-in via `lockPointer`): mouse motion
 *    is mouse-look; Esc exits natively. Clicks/drags are ignored meanwhile.
 * The element must have `touch-action: none` so the browser doesn't consume
 * the gestures.
 */

export interface TouchControlsCallbacks {
  /** ndc coordinates of the tap (-1..1, three.js raycaster convention) */
  onDoubleTap: (ndcX: number, ndcY: number) => void;
  /** one finger or pen held still for LONG_PRESS_MS, in ndc */
  onLongPress?: (ndcX: number, ndcY: number) => void;
  /** a single tap or click, in ndc (every tap, before any double), and
   *  what made it: "mouse", "touch" or "pen" */
  onTap?: (ndcX: number, ndcY: number, pointerType: string) => void;
  /** drag delta in CSS pixels since the last event */
  onLook: (dxPx: number, dyPx: number) => void;
  /** pointer-locked mouse motion in CSS pixels */
  onMouseLook: (dxPx: number, dyPx: number) => void;
  /** current finger distance / distance at pinch start, and the fingers'
   *  midpoint in NDC */
  onPinch: (ratio: number, midNdcX: number, midNdcY: number) => void;
  onPinchStart: () => void;
  /** two fingers turned by `radians` since the last event (counter-clockwise on screen) */
  onTwist?: (radians: number) => void;
  /** two fingers moved together by (dx, dy) CSS px since the last event */
  onTwoFingerPan?: (dxPx: number, dyPx: number) => void;
  /** a right-button (or Ctrl/⌘) drag: delta in CSS px, and whether Shift is held */
  onAltDrag?: (dxPx: number, dyPx: number, shift: boolean) => void;
  /** a right-button drag or a two-finger gesture ended */
  onDragEnd?: () => void;
  /**
   * The wheel (or a trackpad pinch) as a dolly, in the pinch's units:
   * ln(zoom ratio), > 0 moves forward; the pointer in NDC
   */
  onWheelDolly: (amount: number, ndcX: number, ndcY: number) => void;
  /** one Alt+wheel notch, as a pinch-style ratio: > 1 zooms in */
  onWheelZoom: (ratio: number) => void;
}

/** FOV factor per Alt+wheel notch. */
const WHEEL_ZOOM_STEP = 1.05;
/**
 * px of wheel travel per dolly unit (ln ratio): a mouse notch (≈ 100 px)
 * is a tenth of a pinch to twice the finger distance…
 */
const WHEEL_PX_PER_UNIT = 700;
/**
 * …and a trackpad pinch (a wheel event with ctrlKey, in browsers' small
 * zoom deltas) about as quick as a pinch on glass.
 */
const TRACKPAD_PINCH_PX_PER_UNIT = 100;
/** One wheel event never pushes further than this (a flung trackpad). */
const MAX_WHEEL_UNITS = 0.5;
/** px per line / page, for wheels that do not report pixels. */
const LINE_PX = 16;
const PAGE_PX = 800;

/**
 * Safari's trackpad pinch (it sends no ctrl+wheel): the gesture's scale
 * since it began, at the pointer. Not in TypeScript's DOM types.
 */
interface GestureEventLike extends UIEvent {
  clientX: number;
  clientY: number;
  scale: number;
}

/** Drags beyond this no longer count as a tap. */
const TAP_SLOP_PX = 12;
const TAP_MAX_DURATION_MS = 350;
/** A press held this long without moving past the slop is a long press. */
export const LONG_PRESS_MS = 450;

/** The timer the long press waits on; injected by the unit tests. */
export interface PressTimer {
  clear: (handle: unknown) => void;
  set: (fn: () => void, ms: number) => unknown;
}

const WINDOW_TIMER: PressTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface PointerState {
  /** a right-button / Ctrl drag (`onAltDrag`), not a look */
  alt: boolean;
  startTime: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export interface TouchControls {
  detach: () => void;
  /** Enters immersive mouse-look (desktop); the browser exits it on Esc. */
  lockPointer: () => void;
}

export function attachTouchControls(
  element: HTMLElement,
  callbacks: TouchControlsCallbacks,
  timer: PressTimer = WINDOW_TIMER
): TouchControls {
  const pointers = new Map<number, PointerState>();
  let pinchStartDistance = 0;
  /** the two fingers' line's angle and midpoint at the last event */
  let pairAngle = 0;
  let pairMid = { x: 0, y: 0 };
  /** a right-button drag just ended: its context menu is no menu */
  let altEndedAt = Number.NEGATIVE_INFINITY;
  let dragged = false;
  let lastTap: TapSample | null = null;
  let pressTimer: unknown = null;
  // The release that ends a long press is not a tap.
  let longPressed = false;

  const ndcOf = (clientX: number, clientY: number): [number, number] => {
    const rect = element.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    ];
  };

  const cancelPress = () => {
    if (pressTimer !== null) {
      timer.clear(pressTimer);
      pressTimer = null;
    }
  };

  const armPress = (state: PointerState) => {
    cancelPress();
    if (!callbacks.onLongPress) {
      return;
    }
    pressTimer = timer.set(() => {
      pressTimer = null;
      if (pointers.size === 1 && !dragged) {
        longPressed = true;
        callbacks.onLongPress?.(...ndcOf(state.startX, state.startY));
      }
    }, LONG_PRESS_MS);
  };

  const locked = () => element.ownerDocument.pointerLockElement === element;

  /** The hand: closed while a mouse button drags, else open. */
  const setGrabbing = (grabbing: boolean) => {
    element.style.cursor = grabbing ? "grabbing" : "grab";
  };
  setGrabbing(false);

  const acceptsPointer = (e: PointerEvent): boolean => {
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      return true;
    }
    // Mouse: primary button (and the secondary, where something turns by
    // it), never while pointer-locked (immersive).
    if (locked()) {
      return false;
    }
    return (
      e.button === 0 || (e.button === 2 && callbacks.onAltDrag !== undefined)
    );
  };

  /** a right-button drag, or Ctrl/⌘ with the primary one (a Mac's one button) */
  const isAltDrag = (e: PointerEvent): boolean =>
    callbacks.onAltDrag !== undefined &&
    e.pointerType === "mouse" &&
    (e.button === 2 || e.ctrlKey || e.metaKey);

  /** the two pointers' line: its angle and midpoint (client px) */
  const pairOf = (): { angle: number; mid: { x: number; y: number } } => {
    const [a, b] = [...pointers.values()];
    return {
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const pinchDistance = (): number => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /**
   * Re-anchors the pinch whenever exactly two pointers remain. Capturing the
   * baseline only on the second pointerdown left a stale one behind when a
   * third finger lifted: the surviving pair kept measuring against a distance
   * that belonged to a different pair, and the FOV jumped.
   */
  const syncPinchBaseline = () => {
    if (pointers.size === 2) {
      pinchStartDistance = pinchDistance();
      const pair = pairOf();
      pairAngle = pair.angle;
      pairMid = pair.mid;
      callbacks.onPinchStart();
    } else {
      pinchStartDistance = 0;
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!acceptsPointer(e)) {
      return;
    }
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) carry pointer ids unknown to the browser.
    }
    pointers.set(e.pointerId, {
      alt: isAltDrag(e),
      startTime: e.timeStamp,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    });
    dragged = pointers.size > 1 ? true : dragged;
    if (e.pointerType === "mouse") {
      setGrabbing(true);
    }
    syncPinchBaseline();
    if (pointers.size === 1) {
      longPressed = false;
      if (e.pointerType === "mouse") {
        cancelPress();
      } else {
        armPress(pointers.get(e.pointerId) as PointerState);
      }
    } else {
      cancelPress();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const state = pointers.get(e.pointerId);
    if (!state) {
      return;
    }
    const dx = e.clientX - state.x;
    const dy = e.clientY - state.y;
    state.x = e.clientX;
    state.y = e.clientY;
    if (
      Math.hypot(e.clientX - state.startX, e.clientY - state.startY) >
      TAP_SLOP_PX
    ) {
      dragged = true;
      cancelPress();
    }
    if (pointers.size === 1) {
      if (state.alt) {
        callbacks.onAltDrag?.(dx, dy, e.shiftKey);
      } else {
        callbacks.onLook(dx, dy);
      }
    } else if (pointers.size === 2 && pinchStartDistance > 0) {
      const pair = pairOf();
      const [midX, midY] = ndcOf(pair.mid.x, pair.mid.y);
      callbacks.onPinch(pinchDistance() / pinchStartDistance, midX, midY);
      // the twist, wrapped to the short way round
      let turn = pair.angle - pairAngle;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      if (turn !== 0) {
        callbacks.onTwist?.(-turn);
      }
      const mx = pair.mid.x - pairMid.x;
      const my = pair.mid.y - pairMid.y;
      if (mx !== 0 || my !== 0) {
        callbacks.onTwoFingerPan?.(mx, my);
      }
      pairAngle = pair.angle;
      pairMid = pair.mid;
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    const state = pointers.get(e.pointerId);
    if (!state) {
      return;
    }
    const wasPair = pointers.size === 2;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      setGrabbing(false);
    }
    syncPinchBaseline();
    cancelPress();
    if (state.alt) {
      altEndedAt = e.timeStamp;
      callbacks.onDragEnd?.();
      if (pointers.size === 0) {
        dragged = false;
      }
      return;
    }
    if (wasPair) {
      callbacks.onDragEnd?.();
    }
    if (e.type === "pointercancel") {
      // The browser took the pointer (a system gesture, palm rejection):
      // the press is over, but it was no tap — nor the first of a double.
      lastTap = null;
      if (pointers.size === 0) {
        dragged = false;
      }
      return;
    }
    const isTap =
      !(dragged || longPressed) &&
      pointers.size === 0 &&
      e.timeStamp - state.startTime <= TAP_MAX_DURATION_MS;
    if (isTap) {
      const tap: TapSample = {
        timeMs: e.timeStamp,
        x: e.clientX,
        y: e.clientY,
      };
      const [ndcX, ndcY] = ndcOf(e.clientX, e.clientY);
      callbacks.onTap?.(ndcX, ndcY, e.pointerType);
      if (isDoubleTap(lastTap, tap)) {
        lastTap = null;
        callbacks.onDoubleTap(ndcX, ndcY);
      } else {
        lastTap = tap;
      }
    }
    if (pointers.size === 0) {
      dragged = false;
    }
  };

  /**
   * Where a wheel or a trackpad pinch points: the pointer, or the centre
   * while it is locked (its client position then stays where the lock
   * began, and the crosshair is what aims).
   */
  const aimOf = (clientX: number, clientY: number): [number, number] =>
    locked() ? [0, 0] : ndcOf(clientX, clientY);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY === 0) {
      return;
    }
    if (e.altKey) {
      callbacks.onWheelZoom(
        e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
      );
      return;
    }
    const px =
      e.deltaY *
      (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1);
    const units =
      -px / (e.ctrlKey ? TRACKPAD_PINCH_PX_PER_UNIT : WHEEL_PX_PER_UNIT);
    callbacks.onWheelDolly(
      Math.min(Math.max(units, -MAX_WHEEL_UNITS), MAX_WHEEL_UNITS),
      ...aimOf(e.clientX, e.clientY)
    );
  };

  // Safari's trackpad pinch: its own events, in place of a ctrl+wheel. On
  // an iPhone they come alongside the touch pointers, which already pinch —
  // those win (a trackpad's pinch has no pointer down).
  let gestureScale = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gestureScale = 1;
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as GestureEventLike;
    if (pointers.size > 0 || !(g.scale > 0)) {
      return;
    }
    const units = Math.log(g.scale / gestureScale);
    gestureScale = g.scale;
    callbacks.onWheelDolly(
      Math.min(Math.max(units, -MAX_WHEEL_UNITS), MAX_WHEEL_UNITS),
      ...aimOf(g.clientX, g.clientY)
    );
  };

  // While locked, every mouse event targets the locked element and carries
  // only relative motion.
  const onMouseMove = (e: MouseEvent) => {
    if (locked()) {
      callbacks.onMouseLook(e.movementX, e.movementY);
    }
  };

  // A held finger opens the browser's context menu (Android) or callout
  // (iOS) on the canvas: the long press owns that gesture.
  const onContextMenu = (e: Event) => {
    // (a right-button drag ends on the menu on Windows: it fires after the
    // release)
    if (pointers.size > 0 || longPressed || e.timeStamp - altEndedAt < 400) {
      e.preventDefault();
    }
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("contextmenu", onContextMenu);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerEnd);
  element.addEventListener("pointercancel", onPointerEnd);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("gesturestart", onGestureStart);
  element.addEventListener("gesturechange", onGestureChange);
  element.addEventListener("mousemove", onMouseMove);

  return {
    lockPointer: () => {
      // Rejects outside a user gesture or when the browser denies it; the
      // viewer then simply stays in grab-look, so there is nothing to report.
      element.requestPointerLock()?.catch(() => undefined);
    },
    detach: () => {
      cancelPress();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("contextmenu", onContextMenu);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerEnd);
      element.removeEventListener("pointercancel", onPointerEnd);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
      element.style.cursor = "";
      element.removeEventListener("mousemove", onMouseMove);
      if (locked()) {
        element.ownerDocument.exitPointerLock();
      }
    },
  };
}
