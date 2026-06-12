import { isDoubleTap, type TapSample } from "@/lib/city/touch";

/**
 * Street-view-style canvas gestures via Pointer Events, for touch AND mouse:
 *  - one-pointer drag: look around ("grab the world")
 *  - two-finger pinch: zoom (FOV) — touch only
 *  - double-tap / double-click: travel to the tapped spot
 * Mouse pointers are ignored while pointer lock is active (immersive mode
 * routes mouse-look through PointerLockControls instead). The element must
 * have `touch-action: none` so the browser doesn't consume the gestures.
 */

export interface TouchControlsCallbacks {
  /** ndc coordinates of the tap (-1..1, three.js raycaster convention) */
  onDoubleTap: (ndcX: number, ndcY: number) => void;
  /** drag delta in CSS pixels since the last event */
  onLook: (dxPx: number, dyPx: number) => void;
  /** current finger distance / distance at pinch start */
  onPinch: (ratio: number) => void;
  onPinchStart: () => void;
}

/** Drags beyond this no longer count as a tap. */
const TAP_SLOP_PX = 12;
const TAP_MAX_DURATION_MS = 350;

interface PointerState {
  startTime: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

function acceptsPointer(e: PointerEvent): boolean {
  if (e.pointerType === "touch" || e.pointerType === "pen") {
    return true;
  }
  // Mouse: primary button only, and never while pointer-locked (immersive).
  return e.button === 0 && document.pointerLockElement === null;
}

export function attachTouchControls(
  element: HTMLElement,
  callbacks: TouchControlsCallbacks
): () => void {
  const pointers = new Map<number, PointerState>();
  let pinchStartDistance = 0;
  let dragged = false;
  let lastTap: TapSample | null = null;

  const pinchDistance = (): number => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
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
      startTime: e.timeStamp,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    });
    dragged = pointers.size > 1 ? true : dragged;
    if (pointers.size === 2) {
      pinchStartDistance = pinchDistance();
      callbacks.onPinchStart();
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
    }
    if (pointers.size === 1) {
      callbacks.onLook(dx, dy);
    } else if (pointers.size === 2 && pinchStartDistance > 0) {
      callbacks.onPinch(pinchDistance() / pinchStartDistance);
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    const state = pointers.get(e.pointerId);
    if (!state) {
      return;
    }
    pointers.delete(e.pointerId);
    const isTap =
      !dragged &&
      pointers.size === 0 &&
      e.timeStamp - state.startTime <= TAP_MAX_DURATION_MS;
    if (isTap) {
      const tap: TapSample = {
        timeMs: e.timeStamp,
        x: e.clientX,
        y: e.clientY,
      };
      if (isDoubleTap(lastTap, tap)) {
        lastTap = null;
        const rect = element.getBoundingClientRect();
        callbacks.onDoubleTap(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -(((e.clientY - rect.top) / rect.height) * 2 - 1)
        );
      } else {
        lastTap = tap;
      }
    }
    if (pointers.size === 0) {
      dragged = false;
      pinchStartDistance = 0;
    }
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerEnd);
  element.addEventListener("pointercancel", onPointerEnd);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerEnd);
    element.removeEventListener("pointercancel", onPointerEnd);
  };
}
