import { expect, test } from "bun:test";
import {
  attachTouchControls,
  type TouchControlsCallbacks,
} from "./touch-controls";

interface FiredPointer {
  clientX: number;
  clientY: number;
  pointerId: number;
  timeStamp?: number;
}

/**
 * DOM-free harness: a fake element that records the listeners
 * attachTouchControls registers, so a test can replay pointer events against
 * them. Touch pointers never consult `document`, so no browser is needed.
 */
function harness() {
  const handlers = new Map<string, (e: PointerEvent) => void>();
  const element = {
    addEventListener: (type: string, fn: (e: PointerEvent) => void) =>
      handlers.set(type, fn),
    removeEventListener: (type: string) => handlers.delete(type),
    setPointerCapture: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  } as unknown as HTMLElement;

  const calls = {
    look: [] as [number, number][],
    pinchStart: 0,
    pinch: [] as number[],
    doubleTap: [] as [number, number][],
  };
  const callbacks: TouchControlsCallbacks = {
    onLook: (dx, dy) => calls.look.push([dx, dy]),
    onPinchStart: () => {
      calls.pinchStart += 1;
    },
    onPinch: (ratio) => calls.pinch.push(ratio),
    onDoubleTap: (x, y) => calls.doubleTap.push([x, y]),
  };
  const detach = attachTouchControls(element, callbacks);
  const fire = (type: string, e: FiredPointer) =>
    handlers.get(type)?.({
      pointerType: "touch",
      button: 0,
      timeStamp: 0,
      ...e,
    } as unknown as PointerEvent);
  return { calls, detach, fire };
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

test("detach removes every listener", () => {
  const { fire, calls, detach } = harness();
  detach();
  fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0 });
  fire("pointermove", { pointerId: 1, clientX: 10, clientY: 0 });
  expect(calls.look).toEqual([]);
  expect(calls.pinchStart).toBe(0);
});
