import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { createNetGate, type GatePage } from "./net-gate";

/** A page on a clock the test moves: visible and online until told. */
function fakePage() {
  let t = 0;
  const window = new EventTarget();
  const shown: { visibilityState: DocumentVisibilityState } = {
    visibilityState: "visible",
  };
  const document = Object.assign(new EventTarget(), shown);
  const navigator = { onLine: true };
  const page: GatePage = { window, document, navigator, now: () => t };
  return {
    page,
    pass: (ms: number) => {
      t += ms;
    },
    online: (onLine: boolean) => {
      navigator.onLine = onLine;
      window.dispatchEvent(new Event(onLine ? "online" : "offline"));
    },
    visible: (shown: boolean) => {
      document.visibilityState = shown ? "visible" : "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    },
    hide: () => window.dispatchEvent(new Event("pagehide")),
    /** a pageshow: `persisted` when the page comes back from the bfcache */
    show: (persisted: boolean) =>
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted })),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test("a visible page's time counts against the budgets, offline or not; a hidden page's does not", () => {
  const p = fakePage();
  const gate = createNetGate(p.page);
  p.pass(1000);
  // a tunnel: the requests fail, and their budgets run out, so an outage
  // ends in a give-up the healer and the boot take up
  p.online(false);
  p.pass(5000);
  expect(gate.usable()).toBe(false);
  expect(gate.visibleMs()).toBe(6000);
  // in a pocket: nothing could succeed, nothing is spent
  p.visible(false);
  p.pass(60_000);
  expect(gate.visibleMs()).toBe(6000);
  p.visible(true);
  p.online(true);
  p.pass(500);
  expect(gate.usable()).toBe(true);
  expect(gate.visibleMs()).toBe(6500);
});

test("a retry waits for a usable page: at once when it is, on 'online', and every 15 s on a visible page called offline", async () => {
  const p = fakePage();
  const gate = createNetGate(p.page);
  let woken = 0;
  const wake = () => {
    woken++;
  };
  await gate.whenUsable();
  p.online(false);
  void gate.whenUsable().then(wake);
  jest.advanceTimersByTime(14_999);
  await Promise.resolve();
  expect(woken).toBe(0);
  jest.advanceTimersByTime(1);
  await Promise.resolve();
  expect(woken).toBe(1);
  void gate.whenUsable().then(wake);
  p.online(true);
  await Promise.resolve();
  expect(woken).toBe(2);
});

test("a page is leaving from pagehide until the bfcache gives it back", () => {
  const p = fakePage();
  const gate = createNetGate(p.page);
  expect(gate.leaving()).toBe(false);
  p.hide();
  expect(gate.leaving()).toBe(true);
  // a pageshow that is no return from the bfcache changes nothing
  p.show(false);
  expect(gate.leaving()).toBe(true);
  p.show(true);
  expect(gate.leaving()).toBe(false);
});

test("an aborted wait rejects at once and leaves no probe behind", async () => {
  const p = fakePage();
  const gate = createNetGate(p.page);
  // aborted before it is asked: at once, even on a usable page
  const before = new AbortController();
  before.abort();
  // oxlint-disable-next-line typescript/await-thenable
  await expect(gate.whenUsable(before.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  p.online(false);
  const aborter = new AbortController();
  const waiting = gate.whenUsable(aborter.signal);
  expect(jest.getTimerCount()).toBe(1); // the offline probe
  aborter.abort();
  // oxlint-disable-next-line typescript/await-thenable
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  // its probe is cleared (an armed one would re-arm every 15 s for good)
  expect(jest.getTimerCount()).toBe(0);
});
