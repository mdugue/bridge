import { expect, test } from "bun:test";
import {
  bikeCard,
  hourEstimate,
  lineBearing,
  towardCompass,
  trafficCard,
  type TrafficInquiry,
} from "./inquiry-traffic";

const antonstrasse: TrafficInquiry = {
  kind: "traffic",
  tile: "33412_5656_2_sn",
  index: 0,
  position: [412111.6, 5657692.6],
  // Dresden's committed section, drawn from the east end to the west one
  bearing: lineBearing([
    [412186.6, 5657663.57],
    [412036.59, 5657721.64],
  ]),
  properties: {
    t: 15_000,
    f: 9000,
    hf: 0.073,
    b: 6000,
    hb: 0.067,
    y: 2025,
    m: "detector",
    n: "Antonstraße",
  },
  credit: "Verkehrsmengen: Landeshauptstadt Dresden, dl-de/by-2-0",
};

// Intl sets a no-break space before the per-cent sign
const value = (card: ReturnType<typeof trafficCard>, label: string) =>
  card.facts.find((f) => f.label === label)?.value.replace(/\u00a0/g, " ");

test("a direction is named by the compass point it heads to", () => {
  expect(towardCompass(0)).toBe("Norden");
  expect(towardCompass(91)).toBe("Osten");
  expect(towardCompass(-69)).toBe("Westen");
  expect(towardCompass(225)).toBe("Südwesten");
});

test("a section counted per direction says each, with its heavy goods", () => {
  const card = trafficCard(antonstrasse);
  expect(card.title).toBe("Antonstraße");
  expect(value(card, "Beide Richtungen")).toBe("15.000 Kfz/Tag");
  // drawn westward: `f` flows west, `b` east
  expect(value(card, "Richtung Westen")).toBe(
    "9.000 Kfz/Tag · 7,3 % Schwerverkehr"
  );
  expect(value(card, "Richtung Osten")).toBe(
    "6.000 Kfz/Tag · 6,7 % Schwerverkehr"
  );
  expect(value(card, "Gezählt")).toBe("2025 · Detektor, Jahresmittel");
  expect(card.sources).toEqual([
    "Verkehrsmengen: Landeshauptstadt Dresden, dl-de/by-2-0",
  ]);
});

test("a census split evenly says so instead of inventing directions", () => {
  const card = trafficCard({
    ...antonstrasse,
    properties: {
      t: 10_479,
      f: 5240,
      b: 5239,
      sp: 1,
      y: 2021,
      m: "census",
      n: "B 107",
    },
  });
  expect(card.facts.some((f) => f.label.startsWith("Richtung"))).toBe(false);
  expect(value(card, "Aufteilung")).toBe(
    "je zur Hälfte, nicht je Richtung gezählt"
  );
});

test("the hour is an estimate from the day's curve, and says whose curve", () => {
  expect(hourEstimate(15_000, 1)).toBe(630);
  expect(hourEstimate(15_000, 1.8)).toBe(1130);
  const card = trafficCard({
    ...antonstrasse,
    hour: { kind: "weekday", factor: 1.8, time: "17:30" },
  });
  expect(value(card, "Um 17:30 (Werktag)")).toBe("≈ 1.130 Kfz/Stunde");
  expect(card.sources.at(-1)).toContain("typischen Tagesgang");
});

test("a counter says its bicycles per direction and when they were counted", () => {
  const measuredAt = new Date(2026, 9, 1, 14, 0);
  const fresh = bikeCard({
    kind: "bikes",
    id: "100",
    name: "Albertbrücke",
    where: "in Höhe Rosa-Luxemburg-Platz",
    directions: [
      { count: 212, toward: "Neustadt" },
      { count: 180, toward: "Altstadt" },
    ],
    measuredAt,
    now: new Date(2026, 9, 1, 15, 0),
    position: [412700, 5657300],
    staleAfterMs: 3 * 3600_000,
    credit: "Radzählstellen: Landeshauptstadt Dresden, dl-de/by-2-0",
  });
  expect(fresh.title).toBe("Albertbrücke");
  expect(fresh.facts[0]).toEqual({
    label: "Richtung Neustadt",
    value: "212 Räder in der Stunde",
  });
  expect(fresh.facts.at(-1)?.value).not.toContain("älter");
  const old = bikeCard({
    kind: "bikes",
    id: "100",
    name: "Albertbrücke",
    where: "",
    directions: [{ count: 3, toward: "" }],
    measuredAt,
    now: new Date(2026, 9, 1, 20, 0),
    position: [412700, 5657300],
    staleAfterMs: 3 * 3600_000,
  });
  expect(old.facts.at(-1)?.value).toContain("älter als drei Stunden");
  expect(old.sources).toEqual([]);
});

test("a counter's time is the city's clock, whatever the visitor's zone", () => {
  // 07:00 in Dresden (CEST); under TZ=Asia/Tokyo a local clock says 14:00
  const measuredAt = new Date("2026-10-01T05:00:00Z");
  const card = bikeCard({
    kind: "bikes",
    id: "100",
    name: "Albertbrücke",
    where: "",
    directions: [{ count: 3, toward: "" }],
    measuredAt,
    now: measuredAt,
    position: [412700, 5657300],
    staleAfterMs: 3 * 3600_000,
  });
  expect(card.facts.at(-1)?.value).toBe("01.10., 07:00 Uhr");
});
