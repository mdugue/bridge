import { expect, test } from "bun:test";
import {
  attachTouchControls,
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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  } as unknown as HTMLElement;

  const calls = {
    look: [] as [number, number][],
    mouseLook: [] as [number, number][],
    pinchStart: 0,
    pinch: [] as number[],
    doubleTap: [] as [number, number][],
    wheel: [] as number[],
  };
  const callbacks: TouchControlsCallbacks = {
    onLook: (dx, dy) => calls.look.push([dx, dy]),
    onMouseLook: (dx, dy) => calls.mouseLook.push([dx, dy]),
    onPinchStart: () => {
      calls.pinchStart += 1;
    },
    onPinch: (ratio) => calls.pinch.push(ratio),
    onDoubleTap: (x, y) => calls.doubleTap.push([x, y]),
    onWheel: (ratio) => calls.wheel.push(ratio),
  };
  const { detach } = attachTouchControls(element, callbacks);
  const fire = (type: string, e: FiredPointer) =>
    handlers.get(type)?.({
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
  const wheel = (deltaY: number) => {
    let prevented = false;
    handlers.get("wheel")?.({
      deltaY,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as PointerEvent);
    return prevented;
  };
  return { calls, detach, fire, lock, mouseMove, ownerDocument, wheel };
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
});

test("a wheel notch is one zoom step, up = in, and the page never scrolls", () => {
  const { wheel, calls } = harness();
  expect(wheel(-100)).toBe(true);
  expect(wheel(100)).toBe(true);
  expect(calls.wheel).toHaveLength(2);
  expect(calls.wheel[0]).toBeGreaterThan(1);
  expect(calls.wheel[1]).toBeCloseTo(1 / calls.wheel[0], 10);
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
