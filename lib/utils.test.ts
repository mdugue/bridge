import { expect, test } from "bun:test";
import { cn } from "./utils";

test("cn merges class names", () => {
  expect(cn("px-2", "py-1")).toBe("px-2 py-1");
});

test("cn dedupes conflicting tailwind classes, last wins", () => {
  expect(cn("px-2", "px-4")).toBe("px-4");
});

test("cn handles conditional and falsy values", () => {
  expect(cn("base", false, null, undefined, "active")).toBe("base active");
});
