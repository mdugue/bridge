import { expect, test } from "bun:test";
import {
  recentlyRecovered,
  recoverFromGpuLoss,
  takeRecoverySnapshot,
} from "./gpu-recovery";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

test("a lost GPU reloads where the player stood, and the next load puts it back once", () => {
  const store = memoryStore();
  let reloads = 0;
  const reload = () => {
    reloads++;
  };
  expect(recoverFromGpuLoss('{"camera":1}', store, reload, 0)).toBe(true);
  expect(reloads).toBe(1);
  expect(takeRecoverySnapshot(store)).toBe('{"camera":1}');
  expect(takeRecoverySnapshot(store)).toBeNull();
  // the page after it knows it followed a recovery, for two minutes
  expect(recentlyRecovered(store, 60_000)).toBe(true);
  expect(recentlyRecovered(store, 121_000)).toBe(false);
});

test("twice in ten minutes, then the message instead of a reload loop", () => {
  const store = memoryStore();
  let reloads = 0;
  const reload = () => {
    reloads++;
  };
  expect(recoverFromGpuLoss(null, store, reload, 0)).toBe(true);
  expect(recoverFromGpuLoss(null, store, reload, 30_000)).toBe(true);
  expect(recoverFromGpuLoss(null, store, reload, 60_000)).toBe(false);
  expect(reloads).toBe(2);
  // once the first try is ten minutes old, a reload is allowed again
  expect(recoverFromGpuLoss(null, store, reload, 599_000)).toBe(false);
  expect(recoverFromGpuLoss(null, store, reload, 601_000)).toBe(true);
});

test("a phone that loses its GPU a minute after each boot does not reload forever", () => {
  const store = memoryStore();
  let reloads = 0;
  const reload = () => {
    reloads++;
  };
  // boot, stream back to the heavy view, lose the GPU again — every 70 s
  expect(recoverFromGpuLoss(null, store, reload, 0)).toBe(true);
  expect(recoverFromGpuLoss(null, store, reload, 70_000)).toBe(true);
  expect(recoverFromGpuLoss(null, store, reload, 140_000)).toBe(false);
  expect(reloads).toBe(2);
});

test("without storage it gives up rather than reloading blind", () => {
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  let reloads = 0;
  expect(
    recoverFromGpuLoss("{}", broken, () => {
      reloads++;
    })
  ).toBe(false);
  expect(reloads).toBe(0);
});

test("with site data blocked, reading session storage throws: all three give up quietly", () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  try {
    let reloads = 0;
    expect(
      recoverFromGpuLoss("{}", undefined, () => {
        reloads++;
      })
    ).toBe(false);
    expect(reloads).toBe(0);
    expect(recentlyRecovered()).toBe(false);
    expect(takeRecoverySnapshot()).toBeNull();
  } finally {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
