import { expect, test } from "bun:test";
import {
  attachKeyboardControls,
  type KeyboardActions,
  type KeyboardTargets,
} from "./keyboard-controls";

interface FiredKey {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

/**
 * DOM-free harness: fake document/window that record the listeners the
 * adapter registers, so a test can replay key events against them.
 */
function harness() {
  const handlers = new Map<string, (e: never) => void>();
  const listenerApi = {
    addEventListener: (type: string, fn: (e: never) => void) =>
      handlers.set(type, fn),
    removeEventListener: (type: string) => handlers.delete(type),
  };
  const state = { hidden: false };
  const targets = {
    document: {
      ...listenerApi,
      get hidden() {
        return state.hidden;
      },
    },
    window: listenerApi,
  } as unknown as KeyboardTargets;

  const calls: string[] = [];
  const actions: KeyboardActions = {
    press: (code) => calls.push(`press:${code}`),
    release: (code) => calls.push(`release:${code}`),
    releaseAll: () => calls.push("releaseAll"),
    cycleStyle: () => calls.push("cycleStyle"),
    demolish: () => calls.push("demolish"),
    toggleMode: () => calls.push("toggleMode"),
    viewpoint: (index) => calls.push(`viewpoint:${index}`),
  };
  const detach = attachKeyboardControls(targets, actions);
  const fire = (type: string, e: FiredKey | Record<string, never> = {}) =>
    handlers.get(type)?.({ repeat: false, target: null, ...e } as never);
  return { calls, detach, fire, state };
}

test("a movement key presses and releases; one-shots fire on their key", () => {
  const { fire, calls } = harness();
  fire("keydown", { code: "KeyW" });
  fire("keyup", { code: "KeyW" });
  fire("keydown", { code: "KeyR" });
  fire("keydown", { code: "KeyF" });
  fire("keydown", { code: "KeyV" });
  expect(calls).toEqual([
    "press:KeyW",
    "release:KeyW",
    "press:KeyR",
    "demolish",
    "press:KeyF",
    "toggleMode",
    "press:KeyV",
    "cycleStyle",
  ]);
});

test("a browser chord (Cmd/Ctrl+V, +F, +R) fires no one-shot", () => {
  const { fire, calls } = harness();
  fire("keydown", { code: "KeyV", metaKey: true });
  fire("keydown", { code: "KeyV", ctrlKey: true });
  fire("keydown", { code: "KeyF", metaKey: true });
  fire("keydown", { code: "KeyR", ctrlKey: true });
  expect(calls.filter((c) => !c.startsWith("press:"))).toEqual([]);
});

test("auto-repeat never re-fires a one-shot", () => {
  const { fire, calls } = harness();
  fire("keydown", { code: "KeyR" });
  fire("keydown", { code: "KeyR", repeat: true });
  fire("keydown", { code: "KeyR", repeat: true });
  expect(calls.filter((c) => c === "demolish")).toHaveLength(1);
});

test("keys typed into a text field are the HUD's, but their release still reaches movement", () => {
  const { fire, calls } = harness();
  const input = { matches: (s: string) => s.includes("input") };
  fire("keydown", { code: "KeyW", target: input });
  fire("keydown", { code: "KeyF", target: { isContentEditable: true } });
  fire("keyup", { code: "KeyW", target: input });
  expect(calls).toEqual(["release:KeyW"]);
});

test("losing focus or being hidden releases every key", () => {
  const { fire, calls, state } = harness();
  fire("blur");
  fire("visibilitychange");
  state.hidden = true;
  fire("visibilitychange");
  expect(calls).toEqual(["releaseAll", "releaseAll"]);
});

test("detach removes every listener", () => {
  const { fire, calls, detach, state } = harness();
  detach();
  state.hidden = true;
  fire("keydown", { code: "KeyW" });
  fire("keyup", { code: "KeyW" });
  fire("visibilitychange");
  fire("blur");
  expect(calls).toEqual([]);
});

test("the digit keys glide to the numbered viewpoints, not with a modifier", () => {
  const { fire, calls } = harness();
  fire("keydown", { code: "Digit1" });
  fire("keydown", { code: "Digit9" });
  fire("keydown", { code: "Digit0" });
  fire("keydown", { code: "Digit2", ctrlKey: true });
  fire("keydown", { code: "Digit3", repeat: true });
  expect(calls.filter((c) => c.startsWith("viewpoint"))).toEqual([
    "viewpoint:0",
    "viewpoint:8",
  ]);
});
