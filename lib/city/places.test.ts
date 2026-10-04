import { expect, test } from "bun:test";
import type { Landmark } from "./landmarks";
import { filterPlaces, placeWords, sitePlaces } from "./places";
import { overlook, type Viewpoint } from "./site";

const walk = (id: string, label: string): Viewpoint => ({
  id,
  label,
  description: `${label}, zu Fuß`,
  mode: "walk",
  epsg: { x: 0, y: 0 },
  aboveGround: 1.7,
  headingDeg: 0,
  pitchDeg: 2,
  fov: 60,
});

const landmark = (name: string, x = 5000, y = 5000, also?: string[]) =>
  ({
    h: 30,
    id: `Q-${name}`,
    links: 10,
    name,
    x,
    y,
    ...(also ? { also } : {}),
  }) satisfies Landmark;

test("a place's words: no fillers, no city, no brackets, one stem per ending", () => {
  expect(placeWords("Am Japanischen Palais")).toEqual(
    placeWords("Japanisches Palais")
  );
  expect(placeWords("Dresden Hauptbahnhof", "Dresden")).toEqual(
    placeWords("Über dem Hauptbahnhof")
  );
  expect(placeWords("St. Katharinen (Hamburg)")).toEqual(["st", "katharin"]);
  expect(placeWords("Frauenkirche, München", "München")).toEqual([
    "frauenkirch",
  ]);
});

test("a landmark a vantage names is folded into it, not listed twice", () => {
  const places = sitePlaces(
    [
      walk("zwinger", "Zwinger & Semperoper"),
      walk("bahnhof", "Hauptbahnhof"),
      walk("palais", "Am Japanischen Palais"),
    ],
    [
      landmark("Semperoper"),
      landmark("Dresden Hauptbahnhof"),
      landmark("Japanisches Palais"),
      landmark("Zwinger"),
      landmark("Kreuzkirche"),
    ],
    "Dresden"
  );
  expect(places.map((p) => p.label)).toEqual([
    "Zwinger & Semperoper",
    "Hauptbahnhof",
    "Am Japanischen Palais",
    "Kreuzkirche",
  ]);
  expect(places[0].also).toEqual(["Semperoper", "Zwinger"]);
  expect(places[1].also).toEqual(["Dresden Hauptbahnhof"]);
  expect(places[3]).toMatchObject({ kind: "landmark", mode: "fly" });
});

test("a short vantage name does not swallow a longer landmark", () => {
  const places = sitePlaces(
    [walk("markt", "Markt")],
    [landmark("Markt 10"), landmark("Alter Markt am Rathaus")]
  );
  // "Markt 10" is the house on the Markt; the other is a place of its own
  expect(places.map((p) => p.label)).toEqual([
    "Markt",
    "Alter Markt am Rathaus",
  ]);
});

test("a landmark under a steep vantage is what it looks at", () => {
  const target = { x: 1000, y: 2000 };
  const above = overlook(target, {
    id: "above",
    label: "Über den Dächern",
    description: "",
    altitude: 150,
    headingDeg: 200,
    pitchDeg: -45,
  });
  const places = sitePlaces(
    [above],
    [
      landmark("Gemäldegalerie", target.x + 30, target.y - 20),
      landmark("Kreuzkirche", target.x + 400, target.y),
    ]
  );
  expect(places.map((p) => p.label)).toEqual([
    "Über den Dächern",
    "Kreuzkirche",
  ]);
  expect(places[0].also).toEqual(["Gemäldegalerie"]);
});

test("a landmark housing another is found by both names", () => {
  const places = sitePlaces(
    [walk("brauerei", "Lindenbrauerei")],
    [landmark("Zentrum für Lichtkunst", 0, 0, ["Lindenbrauerei"])]
  );
  expect(places).toHaveLength(1);
  expect(places[0].also).toEqual(["Zentrum für Lichtkunst", "Lindenbrauerei"]);
});

test("the first nine vantages keep their keys; landmarks have none", () => {
  const vantages = Array.from({ length: 11 }, (_, i) =>
    walk(`v${i}`, `Ort ${i}`)
  );
  const places = sitePlaces(vantages, [landmark("Kreuzkirche")]);
  expect(places.map((p) => p.key)).toEqual([
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    undefined,
    undefined,
    undefined,
  ]);
});

test("a search finds a place by any part of its names, folded ones too", () => {
  const places = sitePlaces(
    [walk("zwinger", "Zwinger & Semperoper"), walk("elbe", "Elbufer")],
    [
      landmark("Gemäldegalerie Alte Meister", 0, 0),
      landmark("Semperoper", 0, 0, ["Sempergalerie"]),
    ]
  );
  expect(filterPlaces(places, "sem").map((p) => p.id)).toEqual(["zwinger"]);
  // inside a compound, and through what a vantage shows
  expect(filterPlaces(places, "galerie").map((p) => p.label)).toEqual([
    "Zwinger & Semperoper",
    "Gemäldegalerie Alte Meister",
  ]);
  expect(filterPlaces(places, "alte").map((p) => p.label)).toEqual([
    "Gemäldegalerie Alte Meister",
  ]);
  expect(filterPlaces(places, "  ")).toHaveLength(places.length);
  expect(filterPlaces(places, "elbe ufer")).toHaveLength(0);
  expect(filterPlaces(places, "ELB").map((p) => p.id)).toEqual(["elbe"]);
});
