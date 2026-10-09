import { expect, test } from "bun:test";
import {
  attachTouchControls,
  type PressTimer,
  type TouchControlsCallbacks,
} from "./touch-controls";

interface FiredPointer {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType?: string;
  timeStamp?: number;
}

/**
 * DOM-free harness: a fake element that records the listeners
 * attachTouchControls registers, so a test can replay pointer events against
 * them. Touch pointers never consult `document`, so no browser is needed.
 */
function harness() {
  const handlers = new Map<string, (e: PointerEvent) => void>();
  const ownerDocument = {
    pointerLockElement: null as unknown,
    exitPointerLock: () => {
      ownerDocument.pointerLockElement = null;
    },
  };
  const element = {
    ownerDocument,
    addEventListener: (type: string, fn: (e: PointerEvent) => void) =>
      handlers.set(type, fn),
    removeEventListener: (type: string) => handlers.delete(type),
    setPointerCapture: () => undefined,
    style: { cursor: "" },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  } as unknown as HTMLElement;

  const calls = {
    look: [] as [number, number][],
    mouseLook: [] as [number, number][],
    pinchStart: 0,
    pinch: [] as number[],
    doubleTap: [] as [number, number][],
    tap: [] as [number, number][],
    tapBy: [] as string[],
    longPress: [] as [number, number][],
    wheel: [] as number[],
    wheelAt: [] as [number, number][],
    zoom: [] as number[],
  };
  const callbacks: TouchControlsCallbacks = {
    onLook: (dx, dy) => calls.look.push([dx, dy]),
    onMouseLook: (dx, dy) => calls.mouseLook.push([dx, dy]),
    onPinchStart: () => {
      calls.pinchStart += 1;
    },
    onPinch: (ratio) => calls.pinch.push(ratio),
    onDoubleTap: (x, y) => calls.doubleTap.push([x, y]),
    onWheelDolly: (amount, x, y) => {
      calls.wheel.push(amount);
      calls.wheelAt.push([x, y]);
    },
    onWheelZoom: (ratio) => calls.zoom.push(ratio),
    onTap: (x, y, pointerType) => {
      calls.tap.push([x, y]);
      calls.tapBy.push(pointerType);
    },
    onLongPress: (x, y) => calls.longPress.push([x, y]),
  };
  // The long press's timer, fired by hand: `elapse()` runs what is due.
  let pending: (() => void) | null = null;
  const timer: PressTimer = {
    set: (fn) => {
      pending = fn;
      return fn;
    },
    clear: (handle) => {
      if (pending === handle) {
        pending = null;
      }
    },
  };
  const elapse = () => {
    const fn = pending;
    pending = null;
    fn?.();
  };
  const { detach } = attachTouchControls(element, callbacks, timer);
  const fire = (type: string, e: FiredPointer) =>
    handlers.get(type)?.({
      type,
      pointerType: "touch",
      button: 0,
      timeStamp: 0,
      ...e,
    } as unknown as PointerEvent);
  const lock = (on: boolean) => {
    ownerDocument.pointerLockElement = on ? element : null;
  };
  const mouseMove = (movementX: number, movementY: number) =>
    handlers.get("mousemove")?.({
      movementX,
      movementY,
    } as unknown as PointerEvent);
  const wheel = (
    deltaY: number,
    mods: {
      altKey?: boolean;
      clientX?: number;
      clientY?: number;
      ctrlKey?: boolean;
      deltaMode?: number;
    } = {}
  ) => {
    let prevented = false;
    handlers.get("wheel")?.({
      deltaY,
      deltaMode: 0,
      clientX: 200,
      clientY: 400,
      ...mods,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as PointerEvent);
    return prevented;
  };
  const contextMenu = () => {
    let prevented = false;
    handlers.get("contextmenu")?.({
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as PointerEvent);
    return prevented;
  };
  /** Safari's trackpad pinch: its gesture events, at a client point */
  const gesture = (type: string, scale: number, clientX = 200, clientY = 400) =>
    handlers.get(type)?.({
      clientX,
      clientY,
      scale,
      preventDefault: () => undefined,
    } as unknown as PointerEvent);
  return {
    calls,
    contextMenu,
    detach,
    element,
    gesture,
    elapse,
    fire,
    lock,
    mouseMove,
    ownerDocument,
    wheel,
  };
}

test("a one-finger drag reports per-event deltas, not cumulative ones", () => {
  const { fire, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
  fire("pointermove", { pointerId: 1, clientX: 10, clientY: 0 });
  fire("pointermove", { pointerId: 1, clientX: 15, clientY: -3 });
  expect(calls.look).toEqual([
    [10, 0],
    [5, -3],
  ]);
});

test("two fingers pinch relative to their distance at pinch start", () => {
  const { fire, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
  fire("pointerdown", { pointerId: 2, clientX: 100, clientY: 0 });
  expect(calls.pinchStart).toBe(1);
  fire("pointermove", { pointerId: 2, clientX: 200, clientY: 0 });
  expect(calls.pinch.at(-1)).toBeCloseTo(2, 5);
});

test("lifting one of three fingers re-anchors the pinch on the surviving pair", () => {
  const { fire, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
  fire("pointerdown", { pointerId: 2, clientX: 100, clientY: 0 });
  fire("pointerdown", { pointerId: 3, clientX: 0, clientY: 300 });
  const startsBefore = calls.pinchStart;

  fire("pointerup", { pointerId: 2, clientX: 100, clientY: 0 });
  expect(calls.pinchStart).toBe(startsBefore + 1);

  // The baseline is now the 1-3 distance (300), not the stale 1-2 one (100):
  // a 30 px spread is a 1.1x zoom, not 3.3x.
  fire("pointermove", { pointerId: 3, clientX: 0, clientY: 330 });
  expect(calls.pinch.at(-1)).toBeCloseTo(1.1, 5);
});

test("two quick taps at the same spot fire one double tap in NDC", () => {
  const { fire, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 200, clientY: 400 });
  fire("pointerup", {
    pointerId: 1,
    clientX: 200,
    clientY: 400,
    timeStamp: 10,
  });
  fire("pointerdown", { pointerId: 2, clientX: 200, clientY: 400 });
  fire("pointerup", {
    pointerId: 2,
    clientX: 200,
    clientY: 400,
    timeStamp: 210,
  });
  expect(calls.doubleTap).toHaveLength(1);
  const [ndcX, ndcY] = calls.doubleTap[0];
  expect(ndcX).toBeCloseTo(0, 10);
  expect(ndcY).toBeCloseTo(0, 10);
  // each tap is a tap too (the inquiry mode asks on the first)
  expect(calls.tap).toHaveLength(2);
});

test("a single tap reports its spot in NDC, y up", () => {
  const { fire, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 300, clientY: 200 });
  fire("pointerup", {
    pointerId: 1,
    clientX: 300,
    clientY: 200,
    timeStamp: 10,
  });
  expect(calls.tap).toEqual([[0.5, 0.5]]);
  expect(calls.tapBy).toEqual(["touch"]);
  expect(calls.doubleTap).toEqual([]);
});

test("a click is a tap that says it came from the mouse (the desktop asks by it)", () => {
  const { fire, calls } = harness();
  const mouse = {
    pointerId: 1,
    clientX: 300,
    clientY: 200,
    pointerType: "mouse",
  };
  fire("pointerdown", mouse);
  fire("pointerup", { ...mouse, timeStamp: 10 });
  expect(calls.tapBy).toEqual(["mouse"]);
});

test("a drag is never a tap, so it cannot start a double tap", () => {
  const { fire, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 200, clientY: 400 });
  fire("pointermove", { pointerId: 1, clientX: 230, clientY: 400 });
  fire("pointerup", {
    pointerId: 1,
    clientX: 230,
    clientY: 400,
    timeStamp: 10,
  });
  fire("pointerdown", { pointerId: 2, clientX: 230, clientY: 400 });
  fire("pointerup", {
    pointerId: 2,
    clientX: 230,
    clientY: 400,
    timeStamp: 210,
  });
  expect(calls.doubleTap).toEqual([]);
  expect(calls.tap).toHaveLength(1);
});

test("the wheel moves like a pinch: up = forward, proportional, capped, and the page never scrolls", () => {
  const { wheel, calls } = harness();
  expect(wheel(-100)).toBe(true);
  expect(wheel(100)).toBe(true);
  expect(calls.wheel).toHaveLength(2);
  expect(calls.wheel[0]).toBeGreaterThan(0);
  expect(calls.wheel[1]).toBeCloseTo(-calls.wheel[0], 10);
  // Three lines are 48 px: about half a 100 px notch.
  wheel(-3, { deltaMode: 1 });
  expect(calls.wheel[2]).toBeCloseTo(calls.wheel[0] * 0.48, 10);
  // A trackpad pinch (ctrlKey) reacts to its small deltas; a fling is capped.
  wheel(-10, { ctrlKey: true });
  expect(calls.wheel[3]).toBeGreaterThan(calls.wheel[0] / 2);
  wheel(-100_000);
  expect(calls.wheel[4]).toBe(0.5);
  expect(calls.zoom).toEqual([]);
});

test("the wheel heads for the pointer: its spot comes along in NDC", () => {
  const { wheel, calls } = harness();
  // the element is 400 × 800 at the origin
  wheel(-100, { clientX: 300, clientY: 200 });
  expect(calls.wheelAt).toEqual([[0.5, 0.5]]);
});

test("in pointer lock the wheel heads for the crosshair, not where the lock began", () => {
  const { wheel, lock, gesture, calls } = harness();
  lock(true);
  wheel(-100, { clientX: 300, clientY: 200 });
  gesture("gesturestart", 1);
  gesture("gesturechange", 1.2, 300, 200);
  expect(calls.wheelAt).toEqual([
    [0, 0],
    [0, 0],
  ]);
});

test("Safari's gesture events leave a pinch to the touch pointers down", () => {
  const { fire, gesture, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
  gesture("gesturestart", 1);
  gesture("gesturechange", 1.5);
  expect(calls.wheel).toEqual([]);
});

test("Safari's trackpad pinch dollies like a pinch, about the pointer", () => {
  const { gesture, calls } = harness();
  gesture("gesturestart", 1);
  gesture("gesturechange", 2, 100, 600);
  gesture("gesturechange", 2);
  gesture("gesturechange", 1);
  expect(calls.wheel).toHaveLength(3);
  // twice the spread is ln 2 forward, capped like a flung wheel
  expect(calls.wheel[0]).toBe(0.5);
  expect(calls.wheel[1]).toBe(0);
  expect(calls.wheel[2]).toBe(-0.5);
  expect(calls.wheelAt[0]).toEqual([-0.5, -0.5]);
});

test("the mouse cursor is an open hand, closed while it drags", () => {
  const { element, fire } = harness();
  expect(element.style.cursor).toBe("grab");
  fire("pointerdown", {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    pointerType: "mouse",
  });
  expect(element.style.cursor).toBe("grabbing");
  fire("pointerup", {
    pointerId: 1,
    clientX: 30,
    clientY: 0,
    pointerType: "mouse",
  });
  expect(element.style.cursor).toBe("grab");
});

test("Alt + wheel is one zoom step, up = in", () => {
  const { wheel, calls } = harness();
  wheel(-100, { altKey: true });
  wheel(100, { altKey: true });
  expect(calls.wheel).toEqual([]);
  expect(calls.zoom[0]).toBeGreaterThan(1);
  expect(calls.zoom[1]).toBeCloseTo(1 / calls.zoom[0], 10);
});

test("pointer lock turns mouse motion into mouse-look and silences grab-look", () => {
  const { fire, lock, mouseMove, calls } = harness();
  mouseMove(5, 0);
  expect(calls.mouseLook).toEqual([]);
  lock(true);
  mouseMove(5, -2);
  fire("pointerdown", {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    pointerType: "mouse",
  });
  fire("pointermove", {
    pointerId: 1,
    clientX: 10,
    clientY: 0,
    pointerType: "mouse",
  });
  expect(calls.mouseLook).toEqual([[5, -2]]);
  expect(calls.look).toEqual([]);
});

test("detach removes every listener and releases the pointer lock", () => {
  const { fire, lock, mouseMove, wheel, calls, detach, ownerDocument } =
    harness();
  lock(true);
  detach();
  expect(ownerDocument.pointerLockElement).toBeNull();
  lock(true);
  fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
  fire("pointermove", { pointerId: 1, clientX: 10, clientY: 0 });
  wheel(-100);
  mouseMove(5, 0);
  expect(calls.look).toEqual([]);
  expect(calls.mouseLook).toEqual([]);
  expect(calls.pinchStart).toBe(0);
  expect(calls.wheel).toEqual([]);
});

test("a finger held still is a long press, and its release is no tap", () => {
  const { fire, calls, elapse, contextMenu } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 200 });
  // the browser's own long-press menu belongs to the gesture now
  expect(contextMenu()).toBe(true);
  elapse();
  expect(calls.longPress).toEqual([[-0.5, 0.5]]);
  fire("pointerup", {
    pointerId: 1,
    clientX: 100,
    clientY: 200,
    timeStamp: 100,
  });
  expect(calls.tap).toEqual([]);
  expect(calls.doubleTap).toEqual([]);
  // the next quick tap is a tap again
  fire("pointerdown", {
    pointerId: 2,
    clientX: 100,
    clientY: 200,
    timeStamp: 1000,
  });
  fire("pointerup", {
    pointerId: 2,
    clientX: 100,
    clientY: 200,
    timeStamp: 1100,
  });
  expect(calls.tap).toHaveLength(1);
});

test("a mouse held still is no long press: the desktop asks by a click", () => {
  const { fire, calls, elapse } = harness();
  fire("pointerdown", {
    pointerId: 1,
    clientX: 100,
    clientY: 200,
    pointerType: "mouse",
  });
  elapse();
  fire("pointermove", {
    pointerId: 1,
    clientX: 160,
    clientY: 200,
    pointerType: "mouse",
  });
  expect(calls.longPress).toEqual([]);
  expect(calls.look).toHaveLength(1);
});

test("moving or a second finger cancels a long press", () => {
  const { fire, calls, elapse } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 200 });
  fire("pointermove", { pointerId: 1, clientX: 140, clientY: 200 });
  elapse();
  fire("pointerup", { pointerId: 1, clientX: 140, clientY: 200 });
  fire("pointerdown", { pointerId: 2, clientX: 100, clientY: 200 });
  fire("pointerdown", { pointerId: 3, clientX: 200, clientY: 200 });
  elapse();
  expect(calls.longPress).toEqual([]);
});

test("a pointer the browser cancels is no tap, nor the first of a double", () => {
  const { fire, calls } = harness();
  fire("pointerdown", { pointerId: 1, clientX: 200, clientY: 400 });
  fire("pointercancel", {
    pointerId: 1,
    clientX: 200,
    clientY: 400,
    timeStamp: 80,
  });
  expect(calls.tap).toHaveLength(0);
  // a quick tap right after is a single tap
  fire("pointerdown", { pointerId: 2, clientX: 200, clientY: 400 });
  fire("pointerup", {
    pointerId: 2,
    clientX: 200,
    clientY: 400,
    timeStamp: 200,
  });
  expect(calls.tap).toHaveLength(1);
  expect(calls.doubleTap).toHaveLength(0);
});
