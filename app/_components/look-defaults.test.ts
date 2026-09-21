import { expect, test } from "bun:test";
import { LOOK_CONTROLS } from "@/lib/city/look-controls";
import { DEFAULT_LOOK_PCT } from "./look-defaults";

test("every look control has an integer default inside its range", () => {
  for (const def of LOOK_CONTROLS) {
    const value = DEFAULT_LOOK_PCT[def.key];
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(def.max ?? 100);
  }
});
