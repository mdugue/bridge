import { expect, test } from "bun:test";
import { mentionRuns } from "./ask-mentions";

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
