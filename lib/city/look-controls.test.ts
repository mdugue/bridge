import { expect, test } from "bun:test";
import {
  LOOK_BY_KEY,
  LOOK_CONTROLS,
  LOOK_DEFAULTS,
  maxValueOf,
} from "./look-controls";

const GROUPS = new Set(["atmosphere", "buildings", "vegetation", "rendering"]);

test("the table has 21 rows with unique keys, ids and snapshot keys", () => {
  expect(LOOK_CONTROLS).toHaveLength(21);
  for (const field of ["key", "id", "snapshotKey"] as const) {
    const values = LOOK_CONTROLS.map((def) => def[field]);
    expect(new Set(values).size).toBe(values.length);
  }
});

test("every row follows the naming conventions and boots inside its range", () => {
  for (const def of LOOK_CONTROLS) {
    expect(def.snapshotKey.endsWith("Pct")).toBe(true);
    expect(GROUPS.has(def.group)).toBe(true);
    expect(LOOK_BY_KEY[def.key]).toBe(def);
    expect(def.initial).toBeGreaterThanOrEqual(0);
    expect(def.initial).toBeLessThanOrEqual(maxValueOf(def));
    // The default is a whole percent, so the slider shows exactly it.
    expect(
      Math.abs(def.initial * 100 - Math.round(def.initial * 100))
    ).toBeLessThan(1e-9);
    expect(LOOK_DEFAULTS[def.key]).toBe(def.initial);
  }
});

test("maxValueOf is the slider maximum as a 0..1 value", () => {
  expect(maxValueOf(LOOK_BY_KEY.fogAmount)).toBe(1);
  expect(maxValueOf(LOOK_BY_KEY.transparency)).toBe(0.9);
});
