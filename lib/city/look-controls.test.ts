import { expect, test } from "bun:test";
import { clampPct, LOOK_BY_KEY, LOOK_CONTROLS } from "./look-controls";

const GROUPS = new Set(["atmosphere", "buildings", "vegetation", "rendering"]);

test("the table has 21 rows with unique keys, ids, setters and snapshot keys", () => {
  expect(LOOK_CONTROLS).toHaveLength(21);
  for (const field of ["key", "id", "setter", "snapshotKey"] as const) {
    const values = LOOK_CONTROLS.map((def) => def[field]);
    expect(new Set(values).size).toBe(values.length);
  }
});

test("every row follows the naming conventions", () => {
  for (const def of LOOK_CONTROLS) {
    expect(def.setter.startsWith("set")).toBe(true);
    expect(def.snapshotKey.endsWith("Pct")).toBe(true);
    expect(GROUPS.has(def.group)).toBe(true);
    expect(LOOK_BY_KEY[def.key]).toBe(def);
  }
});

test("clampPct rounds and clamps to the control's range", () => {
  const fog = LOOK_BY_KEY.fogAmount;
  const transparency = LOOK_BY_KEY.transparency;
  expect(clampPct(fog, -5)).toBe(0);
  expect(clampPct(fog, 150)).toBe(100);
  expect(clampPct(fog, 49.6)).toBe(50);
  expect(clampPct(transparency, 95)).toBe(90);
});
