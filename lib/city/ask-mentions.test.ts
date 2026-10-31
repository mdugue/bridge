import { expect, test } from "bun:test";
import { mentionRuns, placeLabel } from "./ask-mentions";

const places = [{ name: "Kreuzkirche" }, { name: "Residenzschloss Dresden" }];

test("each shown place is linked where the text first names it", () => {
  const runs = mentionRuns(
    "Die Kreuzkirche ist älter als das Residenzschloss. Die Kreuzkirche brannte.",
    places,
    "Dresden"
  );
  expect(runs).toEqual([
    { text: "Die " },
    { text: "Kreuzkirche", place: 0 },
    { text: " ist älter als das " },
    { text: "Residenzschloss", place: 1 },
    { text: ". Die Kreuzkirche brannte." },
  ]);
});

test("a case ending belongs to the name, a longer word does not", () => {
  const runs = mentionRuns(
    "Am Kreuzkirchplatz steht nichts; der Turm des Residenzschlosses schon.",
    places,
    "Dresden"
  );
  expect(runs.filter((r) => "place" in r)).toEqual([
    { text: "Residenzschlosses", place: 1 },
  ]);
});

test("a text without the places is one run", () => {
  expect(mentionRuns("Nichts davon.", places, "Dresden")).toEqual([
    { text: "Nichts davon." },
  ]);
  expect(mentionRuns("", places, "Dresden")).toEqual([]);
});

test("a place is linked once across an answer's paragraphs", () => {
  const linked = new Set<number>();
  const first = mentionRuns("Die Kreuzkirche.", places, "Dresden", linked);
  const second = mentionRuns(
    "Wieder die Kreuzkirche.",
    places,
    "Dresden",
    linked
  );
  expect(first.filter((r) => "place" in r)).toHaveLength(1);
  expect(second).toEqual([{ text: "Wieder die Kreuzkirche." }]);
});

test("a place is named as a reader says it", () => {
  expect(
    placeLabel("Kügelgenhaus – Museum der Dresdner Romantik", "Dresden")
  ).toBe("Kügelgenhaus");
  expect(placeLabel("Pöppelmannbrücke (Grimma)", "Grimma")).toBe(
    "Pöppelmannbrücke"
  );
  expect(placeLabel("Frauenkirche, München", "München")).toBe("Frauenkirche");
  expect(placeLabel("Residenzschloss Dresden", "Dresden")).toBe(
    "Residenzschloss"
  );
  expect(placeLabel("Erich-Kästner-Denkmal", "Dresden")).toBe(
    "Erich-Kästner-Denkmal"
  );
});

test("a text may name a place by its short name or its noun", () => {
  const named = [
    { name: "Kügelgenhaus – Museum der Dresdner Romantik" },
    { name: "Katholische Hofkirche" },
    { name: "Blaues Wunder" },
  ];
  const runs = mentionRuns(
    "Vom Kügelgenhaus sieht man diese Hofkirche nicht, das Wunder auch nicht.",
    named,
    "Dresden"
  );
  expect(runs.filter((r) => "place" in r)).toEqual([
    { text: "Kügelgenhaus", place: 0 },
    { text: "Hofkirche", place: 1 },
  ]);
});
