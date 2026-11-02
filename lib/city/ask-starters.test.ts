import { expect, test } from "bun:test";
import {
  genderOf,
  placesAround,
  STARTERS,
  starterPool,
  starterQuestions,
  starterRiver,
  withArticle,
} from "./ask-starters";
import { riverOf } from "./scenario";

/** A fixed draw: the same numbers every run. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const LANDMARKS = [
  { name: "Frauenkirche", x: 0, y: 300 },
  { name: "Zwinger", x: 400, y: -100 },
  { name: "Semperoper", x: -500, y: -600 },
];

test("a landmark's article comes from its name's ending, or quotes stand in", () => {
  expect(genderOf("Frauenkirche")).toBe("f");
  expect(genderOf("Residenzschloss Dresden")).toBe(null);
  expect(withArticle("Zwinger", "dat")).toBe("dem Zwinger");
  expect(withArticle("Residenzschloss", "nom")).toBe("das Residenzschloss");
  expect(withArticle("Kulturpalast", "nom")).toBe("der Kulturpalast");
  expect(withArticle("Yenidze", "nom")).toBe("„Yenidze“");
});

test("the landmark ahead is the one the view looks at, the nearest the one beside", () => {
  const north = placesAround({
    at: { x: 0, y: 0, headingDeg: 0 },
    landmarks: LANDMARKS,
  });
  expect(north.ahead?.name).toBe("Frauenkirche");
  expect(north.near?.name).toBe("Frauenkirche");
  // looking east, the Zwinger is 14° off the centre and ahead
  const east = placesAround({
    at: { x: 0, y: 0, headingDeg: 90 },
    landmarks: LANDMARKS,
  });
  expect(east.ahead?.name).toBe("Zwinger");
  // looking north-west: nothing ahead within 25°
  const away = placesAround({
    at: { x: 0, y: 0, headingDeg: 300 },
    landmarks: LANDMARKS,
  });
  expect(away.ahead).toBeNull();
});

test("a set holds four different questions, the first about the place", () => {
  for (let seed = 1; seed < 40; seed++) {
    const qs = starterQuestions(
      {
        at: { x: 0, y: 0, headingDeg: 0 },
        now: new Date(2026, 9, 30, 18, 0),
        landmarks: LANDMARKS,
        river: { name: "Elbe", event: "2002", depth: 1.5 },
        layers: ["tramLayer"],
      },
      seeded(seed)
    );
    expect(qs).toHaveLength(STARTERS);
    expect(new Set(qs).size).toBe(STARTERS);
    expect(qs[0]).toContain("Frauenkirche");
    for (const q of qs) {
      expect(q.length).toBeLessThanOrEqual(72);
    }
  }
});

test("without a camera or landmarks the place question is the neighbourhood's", () => {
  const qs = starterQuestions(
    {
      at: null,
      now: new Date(2026, 11, 20, 9, 0),
      landmarks: [],
      river: null,
      layers: [],
    },
    seeded(7)
  );
  expect(qs).toHaveLength(STARTERS);
  expect(qs.join(" ")).not.toContain("Elbe");
});

test("a flood question says here only where that flood reached", () => {
  const ctx = (depth: number | null) => ({
    at: { x: 0, y: 0, headingDeg: 0 },
    now: new Date(2026, 9, 30, 12, 0),
    landmarks: [],
    river: { name: "Elbe", event: "2002", depth },
    layers: [],
  });
  const city = (depth: number | null) =>
    starterPool(ctx(depth))
      .filter((c) => c.kind === "stadt")
      .map((c) => c.question);
  expect(city(2).join(" ")).toContain("2002 hier");
  // on a hill, or where the ground is not loaded: the city's flood
  for (const dry of [-12, null]) {
    expect(city(dry).join(" ")).not.toContain("hier");
    expect(city(dry)).toHaveLength(2);
  }
});

test("the river's highest flood is the one asked, its depth over the ground", () => {
  const elbe = riverOf("dresden");
  // by the Dresden gauge (UTM 33), the 2002 crest at 9.40 m over a 102.7 m zero
  const at = { x: 411_390, y: 5_657_030 };
  const r = starterRiver(elbe, 25_833, at, 105);
  expect(r?.event).toBe("2002");
  expect(r?.depth).toBeGreaterThan(5);
  expect(starterRiver(elbe, 25_833, at, null)?.depth).toBeNull();
  expect(starterRiver(null, 25_833, at, 105)).toBeNull();
});

test("no question asks what the data cannot say", () => {
  const pool = starterPool({
    at: { x: 0, y: 0, headingDeg: 300 },
    now: new Date(2026, 11, 10, 23, 0),
    landmarks: [],
    river: null,
    layers: ["tramLayer", "trafficLayer", "bikeLayer"],
  })
    .map((c) => c.question)
    .join(" ");
  for (const gone of [
    "Weihnachtsmärkte",
    "angestrahlt",
    "gezählt",
    "ältesten Häuser",
    "nach einer Frau",
    "kleinste",
  ]) {
    expect(pool).not.toContain(gone);
  }
});
