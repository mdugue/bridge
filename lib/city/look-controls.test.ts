import { expect, test } from "bun:test";
import {
  LOOK_CONTROLS,
  LOOK_DEFAULTS,
  RETIRED_SNAPSHOT_KEYS,
} from "./look-controls";

test("the table holds the one slider people use, Nebel", () => {
  expect(LOOK_CONTROLS.map((def) => def.key)).toEqual(["fogAmount"]);
  for (const field of ["key", "id", "snapshotKey"] as const) {
    const values = LOOK_CONTROLS.map((def) => def[field]);
    expect(new Set(values).size).toBe(values.length);
  }
});

test("every row follows the naming conventions and boots inside its range", () => {
  for (const def of LOOK_CONTROLS) {
    expect(def.snapshotKey.endsWith("Pct")).toBe(true);
    expect(def.initial).toBeGreaterThanOrEqual(0);
    expect(def.initial).toBeLessThanOrEqual(1);
    // The default is a whole percent, so the slider shows exactly it.
    expect(
      Math.abs(def.initial * 100 - Math.round(def.initial * 100))
    ).toBeLessThan(1e-9);
    expect(LOOK_DEFAULTS[def.key]).toBe(def.initial);
  }
});

test("no row takes a retired snapshot key", () => {
  // A pasted old snapshot would otherwise set the new control (ADR 0017).
  expect(new Set(RETIRED_SNAPSHOT_KEYS).size).toBe(
    RETIRED_SNAPSHOT_KEYS.length
  );
  for (const def of LOOK_CONTROLS) {
    expect(RETIRED_SNAPSHOT_KEYS).not.toContain(def.snapshotKey);
  }
});
