import { expect, test } from "bun:test";
import {
  factsOf,
  knowledgeOf,
  nearKnowledge,
  searchKnowledge,
  sourcesOf,
} from "./ask-knowledge";
import type { StadtwissenIndex, WissenTile } from "./stadtwissen";

const INDEX: StadtwissenIndex = {
  epsg: 25_833,
  site: "dresden",
  sources: {
    osm: { label: "OpenStreetMap", credit: "© OSM", licence: "ODbL" },
  },
  tiles: [{ id: "t", file: "t.json" }],
  landmarks: [
    {
      id: "Q1",
      name: "Frauenkirche",
      tile: "t",
      x: 100,
      y: 100,
      z: 110,
      h: 90,
      links: 40,
      objects: ["a", "b"],
      facts: {
        label: "Frauenkirche",
        claims: { P84: [{ v: "George Bähr" }] },
        wiki: "Frauenkirche Dresden",
      },
    },
  ],
};
const TILE: WissenTile = {
  tile: "t",
  monuments: [
    { id: "m120_100", kind: "Statue", name: "Luther", x: 120, y: 100 },
  ],
  buildings: [
    { id: "a", name: "Frauenkirche", wd: "Q1", x: 100, y: 100, z: 110 },
    {
      id: "c",
      addr: "Neumarkt 1",
      use: "Wohnhaus",
      x: 150,
      y: 100,
      z: 110,
      h: 20,
    },
    { id: "d", x: 140, y: 100, z: 110 },
  ],
};
const K = knowledgeOf(INDEX, [TILE]);

test("a search finds the landmark once, not its parts again", () => {
  const hits = searchKnowledge(K, "frauenkirche");
  expect(hits.map((h) => h.id)).toEqual(["Q1"]);
  expect(searchKnowledge(K, "Neumarkt 1").map((h) => h.id)).toEqual(["c"]);
  expect(searchKnowledge(K, "nichts")).toEqual([]);
});

test("the neighbourhood is nearest first, unnamed buildings left out", () => {
  const near = nearKnowledge(K, 125, 100, 40);
  expect(near.map((h) => h.id)).toEqual(["m120_100", "Q1", "c"]);
  expect(near[0].abstand).toBe(5);
});

test("facts read Wikidata's statements with their sources", () => {
  const f = factsOf(K, "Q1") as Record<string, unknown>;
  expect(f.aussagen).toEqual({ Architekt: "George Bähr" });
  expect(f.quellen).toContain("https://www.wikidata.org/wiki/Q1");
  expect((factsOf(K, "c") as Record<string, unknown>).nutzung).toBe("Wohnhaus");
  expect(factsOf(K, "nope")).toBeNull();
  expect(sourcesOf(K)).toEqual([
    { quelle: "OpenStreetMap", lizenz: "ODbL", vermerk: "© OSM" },
  ]);
});
