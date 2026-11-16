import { describe, expect, test } from "bun:test";
import { layerAnswer, fitsOneView, showAnswer, timeAnswer } from "./ask-shown";

describe("zeige", () => {
  const near = [
    { name: "Kreuzkirche", x: 0, y: 0, r: 30 },
    { name: "Frauenkirche", x: 250, y: 150, r: 30 },
  ];

  test("names what the view shows: all, the answer alone, or the first of far ones", () => {
    expect(showAnswer({ ziele: near }).gezeigt).toEqual([
      "Kreuzkirche",
      "Frauenkirche",
    ]);
    expect(showAnswer({ ziele: near, alle: false }).gezeigt).toEqual([
      "Kreuzkirche",
    ]);
    expect(showAnswer({ ziele: near, aus_der_luft: false }).gezeigt).toEqual([
      "Kreuzkirche",
    ]);
    const far = showAnswer({ ziele: [near[0], { ...near[1], x: 4000 }] });
    expect(far.gezeigt).toEqual(["Kreuzkirche"]);
    expect(far.hinweis).toBeDefined();
    // every place is a chip, whatever the view shows
    expect(far.knoepfe).toHaveLength(2);
  });

  test("one view or one at a time depends on the screen", () => {
    const pair = [
      { name: "A", x: 0, y: 0, r: 30 },
      { name: "B", x: 880, y: 0, r: 30 },
    ];
    // upright on a phone the eye would stand over 900 m off, on a wide
    // screen about half that
    expect(fitsOneView(pair, 0.46)).toBe(false);
    expect(fitsOneView(pair, 1.8)).toBe(true);
    expect(showAnswer({ ziele: pair }, 0.46).gezeigt).toEqual(["A"]);
    expect(showAnswer({ ziele: pair }, 1.8).gezeigt).toEqual(["A", "B"]);
    expect(fitsOneView(near)).toBe(true);
  });
});

test("setze_zeit says the time as the scene's clock sets it", () => {
  expect(timeAnswer({ uhrzeit: "18:30" }).zeit).toBe(
    "Tag wie bisher, 18:30 Uhr"
  );
  // 24:00 is the day's last minute, as the scene's clock sets it
  expect(timeAnswer({ uhrzeit: "24:00", datum: "2026-12-21" }).zeit).toBe(
    "2026-12-21, 23:59 Uhr"
  );
  expect(timeAnswer({ datum: "0929-06-21" }).ok).toBe(true);
});

test("setze_zeit refuses a time no clock or calendar has", () => {
  expect(timeAnswer({ uhrzeit: "25:00" }).ok).toBe(false);
  expect(timeAnswer({ datum: "2026-02-31" }).ok).toBe(false);
  // `Date` would read the first century as 19xx
  expect(timeAnswer({ datum: "0050-06-21" }).ok).toBe(false);
  expect(timeAnswer({ datum: "0100-01-01" }).ok).toBe(false);
  expect(timeAnswer({}).ok).toBe(false);
});

test("datenschicht knows which layers the city has", () => {
  expect(layerAnswer(["tramLayer"], { schicht: "tramLayer" }).ok).toBe(true);
  expect(layerAnswer([], { schicht: "tramLayer" }).ok).toBe(false);
});

const place = (x: number) => ({ name: `P${x}`, x, y: 0 });
const holds = (x: number) => x >= 0 && x < 100;

test("zeige shows the places on the city, eight at most, and refuses none", () => {
  const all = [place(-1), ...Array.from({ length: 10 }, (_, i) => place(i))];
  expect(showAnswer({ ziele: all }, 1, holds).knoepfe).toHaveLength(8);
  const off = showAnswer({ ziele: [place(-1), place(500)] }, 1, holds);
  expect(off.ok).toBe(false);
  expect(off.ausserhalb).toBe(true);
});
