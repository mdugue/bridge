import { expect, test } from "bun:test";
import { instantAt } from "./ask-scene";

test("an hour lands on the given day, or the scene's", () => {
  const day = new Date(2026, 9, 29, 9, 0);
  expect(instantAt(18.5, day)).toEqual(new Date(2026, 9, 29, 18, 30));
  expect(instantAt(6, day, "2026-12-24")).toEqual(new Date(2026, 11, 24, 6, 0));
  // 24 is the day's last minute, not the next day
  expect(instantAt(24, day)).toEqual(new Date(2026, 9, 29, 23, 59));
});
