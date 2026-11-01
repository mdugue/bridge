import { describe, expect, test } from "bun:test";
import { fakeText } from "@tanstack/ai/testing";
import { knowledgeOf } from "./ask-knowledge";
import {
  answerRecorder,
  berlinAt,
  judgeMessage,
  QA_VERDICT,
  qaCases,
  qaLook,
  qaPlaces,
  qaVisitor,
} from "./ask-qa";
import { runAsk } from "./ask-run";
import type {
  StadtwissenIndex,
  WissenLandmark,
  WissenTile,
} from "./stadtwissen";

const landmark = (
  id: string,
  name: string,
  x: number,
  y: number,
  links: number
): WissenLandmark => ({
  id,
  name,
  tile: "t",
  x,
  y,
  z: 110,
  h: 40,
  links,
  objects: [],
  facts: { label: name, claims: {} },
});

const INDEX: StadtwissenIndex = {
  epsg: 25_833,
  site: "dresden",
  sources: {},
  tiles: [{ id: "t", file: "t.json" }],
  landmarks: [
    landmark("Q1", "Frauenkirche", 411_800, 5_656_350, 90),
    // too near the first to be a place of its own
    landmark("Q2", "Kreuzkirche", 411_700, 5_656_100, 80),
    landmark("Q3", "Zwinger", 410_900, 5_656_900, 70),
  ],
};
const TILE: WissenTile = {
  tile: "t",
  monuments: [],
  buildings: [
    { id: "b1", name: "Hof am Rand", x: 414_500, y: 5_653_000, z: 120 },
    { id: "b2", addr: "Neumarkt 1", x: 411_801, y: 5_656_300, z: 111 },
  ],
};
const K = knowledgeOf(INDEX, [TILE]);
const SITE = { epsg: 25_833, id: "dresden", layerKeys: ["tramLayer"] };

describe("the plan", () => {
  test("stands before the most notable landmarks, spread, and once far from all", () => {
    const places = qaPlaces(K, 3);
    expect(places.map((p) => p.ahead)).toEqual(["Q1", "Q3", null]);
    // south of the landmark, looking north at it
    expect(places[0].y).toBeLessThan(5_656_350);
    expect(places[0].heading).toBe(0);
    expect(places[2].name).toBe("Hof am Rand");
    // the ground where the camera stands: the nearest building's base
    expect(places[0].ground).toBe(111);
  });

  test("the hours are Berlin's, winter or summer", () => {
    const hour = (d: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(d);
    expect(berlinAt(new Date("2026-11-01T12:00:00Z"), 8).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z"
    );
    expect(berlinAt(new Date("2026-07-01T12:00:00Z"), 23).toISOString()).toBe(
      "2026-07-01T21:00:00.000Z"
    );
    expect(hour(berlinAt(new Date("2026-03-29T12:00:00Z"), 19))).toBe("19");
  });

  test("asks every question of a place there, the free ones at two places only", () => {
    const places = qaPlaces(K, 3);
    const cases = qaCases(K, SITE, places, new Date(2026, 10, 1));
    const at = (i: number) => cases.filter((c) => c.place === places[i]);
    // the landmark's questions name it, the template does not
    const first = at(0).filter((c) => c.kind === "ort");
    expect(first).toHaveLength(4);
    expect(first.every((c) => c.question.includes("Frauenkirche"))).toBe(true);
    expect(first.every((c) => c.template.includes("{ort}"))).toBe(true);
    expect(first.some((c) => c.template.includes("Frauenkirche"))).toBe(false);
    expect(at(2).some((c) => c.kind === "frei")).toBe(false);
    expect(at(1).some((c) => c.kind === "frei")).toBe(true);
    // each place at another kind of hour
    expect(new Set(places.map((_, i) => at(i)[0].at)).size).toBe(3);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  test("the visitor stands at the place, was_ist_da finds what it looks at", () => {
    const [place] = qaPlaces(K, 1);
    const c = qaCases(K, SITE, [place], new Date(2026, 10, 1))[0];
    expect(qaVisitor(c)).toMatchObject({
      x: place.x,
      y: place.y,
      modus: "walk",
    });
    expect(qaLook(K, place)).toMatchObject({
      gefunden: true,
      name: "Frauenkirche",
    });
  });
});

test("an answer is recorded with its text, calls, turns and timings", async () => {
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [{ name: "suche_stadt", input: { anfrage: "Frauenkirche" } }],
    },
    { text: "Die Frauenkirche, laut Wikidata." },
  ]);
  const record = answerRecorder();
  let ms = 0;
  for await (const chunk of runAsk({
    adapter,
    knowledge: K,
    messages: [{ role: "user", content: "Wo ist die Frauenkirche?" }],
    site: {
      epsg: 25_833,
      floods: [],
      id: "dresden",
      label: "Dresden",
      layers: [],
      layerKeys: [],
      styles: [],
    },
    threadId: "q",
    today: new Date(2026, 10, 1),
  })) {
    record.take(chunk, (ms += 10));
  }
  const a = record.answer;
  expect(a.text).toBe("Die Frauenkirche, laut Wikidata.");
  expect(a.calls.map((c) => c.name)).toEqual(["suche_stadt"]);
  expect(a.calls[0].input).toEqual({ anfrage: "Frauenkirche" });
  expect(a.calls[0].result).toContain("Q1");
  expect(a.turns).toBe(2);
  expect(a.firstTextMs).toBeGreaterThan(0);
  expect(a.totalMs).toBe(ms);
  const message = judgeMessage(
    qaCases(K, SITE, qaPlaces(K, 1), new Date(2026, 10, 1))[0],
    a
  );
  expect(message).toContain("suche_stadt");
  expect(message).toContain("laut Wikidata");
});

test("the verdict's shape holds the judge to its scale", () => {
  const ok = {
    ort_passt: 2,
    daten_reichen: 1,
    antwort: 0,
    erfunden: false,
    urteil: "ersetzen",
    vorschlag: "Wie hoch ist die Frauenkirche?",
    begruendung: "Keine Daten.",
  };
  expect(QA_VERDICT.safeParse(ok).success).toBe(true);
  expect(QA_VERDICT.safeParse({ ...ok, antwort: 3 }).success).toBe(false);
  expect(QA_VERDICT.safeParse({ ...ok, urteil: "löschen" }).success).toBe(
    false
  );
});
