import { expect, test } from "bun:test";
import { composeDate, splitDate } from "./scene-time";

test("a day and a minute compose to a local instant and split back", () => {
  const day = new Date(2026, 11, 21);
  const date = composeDate(day, 8 * 60 + 15);
  expect(date.getHours()).toBe(8);
  expect(date.getMinutes()).toBe(15);
  const parts = splitDate(date);
  expect(parts.minutes).toBe(495);
  expect(parts.day.getTime()).toBe(day.getTime());
});

test("seconds are dropped: the sliders show whole minutes", () => {
  const parts = splitDate(new Date(2026, 5, 1, 23, 59, 40));
  expect(parts.minutes).toBe(23 * 60 + 59);
  expect(parts.day.getDate()).toBe(1);
});
