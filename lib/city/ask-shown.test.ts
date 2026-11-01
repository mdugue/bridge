import { describe, expect, test } from "bun:test";
import {
  floodShown,
  layerAnswer,
  fitsOneView,
  showAnswer,
  timeAnswer,
  volumeShown,
} from "./ask-shown";
import { riverOf } from "./scenario";

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

test("setze_zeit says the hour as a clock does", () => {
  expect(timeAnswer({ stunde: 18.5 }).zeit).toBe("heute, 18:30 Uhr");
  // 24 is the day's last minute, as the scene's clock sets it
  expect(timeAnswer({ stunde: 24, datum: "2026-12-21" }).zeit).toBe(
    "2026-12-21, 23:59 Uhr"
  );
});

test("datenschicht knows which layers the city has", () => {
  expect(layerAnswer(["tramLayer"], { schicht: "tramLayer" }).ok).toBe(true);
  expect(layerAnswer([], { schicht: "tramLayer" }).ok).toBe(false);
});

describe("zeige_hochwasser", () => {
  const elbe = riverOf("dresden");

  test("an event sets its level, aus takes the water away", () => {
    const shown = floodShown(elbe, { ereignis: "2002" });
    expect(shown.answer.ok).toBe(true);
    expect(typeof shown.cm).toBe("number");
    expect(floodShown(elbe, { aus: true }).cm).toBeNull();
  });

  test("an unknown event or a city without gauges changes nothing", () => {
    const unknown = floodShown(elbe, { ereignis: "1066" });
    expect(unknown.cm).toBeUndefined();
    expect(unknown.answer.ereignisse).toBeDefined();
    expect(floodShown(null, { ereignis: "2002" }).cm).toBeUndefined();
  });
});

test("plane_baukoerper clamps the box, takes it away with aus alone", () => {
  const box = volumeShown({ x: 1, y: 2, breite: 1, tiefe: 10, hoehe: 900 });
  expect(box.volume).toMatchObject({ breite: 2, hoehe: 300 });
  expect(volumeShown({ aus: true }).volume).toBeNull();
  const half = volumeShown({ x: 1, y: 2 });
  expect(half.answer.ok).toBe(false);
  expect(half.volume).toBeUndefined();
});
