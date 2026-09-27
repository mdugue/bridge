import { afterEach, expect, test } from "bun:test";
import { readStoredStyle, writeStoredStyle } from "./style-memory";

const globals = globalThis as { localStorage?: unknown };
const original = globals.localStorage;

function fakeStorage(): Map<string, string> {
  const map = new Map<string, string>();
  globals.localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  };
  return map;
}

afterEach(() => {
  globals.localStorage = original;
});

test("a written style reads back", () => {
  fakeStorage();
  expect(readStoredStyle()).toBeNull();
  writeStoredStyle("paper");
  expect(readStoredStyle()).toBe("paper");
});

test("an unknown or renamed style reads as none", () => {
  fakeStorage().set("bildstil", "ghost");
  expect(readStoredStyle()).toBeNull();
});

test("storage that throws neither reads nor breaks", () => {
  globals.localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readStoredStyle()).toBeNull();
  expect(() => writeStoredStyle("noir")).not.toThrow();
});
