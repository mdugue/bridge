import { expect, test } from "bun:test";
import { instantAt } from "./ask-scene";

// 14:00 in Dresden on 29 October 2026, after the clocks went back (UTC+1)
const NOW = new Date(Date.UTC(2026, 9, 29, 13, 0));

test("a time of day stays on the day the city's clock reads", () => {
  expect(instantAt(NOW, { uhrzeit: "18:30" })).toEqual(
    new Date(Date.UTC(2026, 9, 29, 17, 30))
  );
});

test("a date keeps the time of day, in that date's offset", () => {
  // summer: UTC+2, so 14:00 in the city is 12:00 UTC
  expect(instantAt(NOW, { datum: "2026-07-01" })).toEqual(
    new Date(Date.UTC(2026, 6, 1, 12, 0))
  );
});

test("both together set both", () => {
  expect(instantAt(NOW, { datum: "2026-12-24", uhrzeit: "06:00" })).toEqual(
    new Date(Date.UTC(2026, 11, 24, 5, 0))
  );
});

test("the city's day holds where the visitor's has already turned", () => {
  // 23:30 UTC on the 29th is 00:30 on the 30th in Dresden
  const late = new Date(Date.UTC(2026, 9, 29, 23, 30));
  expect(instantAt(late, { uhrzeit: "12:00" })).toEqual(
    new Date(Date.UTC(2026, 9, 30, 11, 0))
  );
});

test("the times on either side of a clock change land right", () => {
  // the clocks go forward at 02:00 on 29 March 2026
  expect(instantAt(NOW, { datum: "2026-03-29", uhrzeit: "01:30" })).toEqual(
    new Date(Date.UTC(2026, 2, 29, 0, 30))
  );
  expect(instantAt(NOW, { datum: "2026-03-29", uhrzeit: "03:30" })).toEqual(
    new Date(Date.UTC(2026, 2, 29, 1, 30))
  );
});

test("24:00 is the day's last minute, not the next day", () => {
  expect(instantAt(NOW, { uhrzeit: "24:00" })).toEqual(
    new Date(Date.UTC(2026, 9, 29, 22, 59))
  );
});

test("a date before the year 1000 is a date like any other", () => {
  const at = instantAt(NOW, { datum: "0929-06-21", uhrzeit: "12:00" });
  expect(at.getUTCFullYear()).toBe(929);
  // and a later change reads that year back
  expect(instantAt(at, { uhrzeit: "13:00" }).getUTCFullYear()).toBe(929);
});
