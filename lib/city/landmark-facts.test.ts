import { expect, test } from "bun:test";
import {
  factLines,
  factsFor,
  indexLandmarkFacts,
  isLandmarkFactsFile,
  type LandmarkFactsEntry,
  landmarkFactsUrl,
} from "./landmark-facts";

const FRAUENKIRCHE: LandmarkFactsEntry = {
  id: "Q157229",
  name: "Frauenkirche",
  buildings: ["DESN_fk"],
  built: [1726, 1734],
  rebuilt: [2005],
  architects: ["George Bähr"],
  height: 91.24,
};

test("the facts read as two lines, each fact where it has one", () => {
  expect(factLines(FRAUENKIRCHE)).toEqual([
    "erbaut 1726–1734 · George Bähr",
    "wiederaufgebaut 2005 · 91 m",
  ]);
  expect(
    factLines({ id: "Q1", name: "x", buildings: [], rebuiltFrom: 1945 })
  ).toEqual(["wiederaufgebaut ab 1945"]);
  expect(
    factLines({
      id: "Q1",
      name: "x",
      buildings: [],
      built: [1900],
      architects: ["A", "B"],
    })
  ).toEqual(["erbaut 1900 · A und B"]);
});

test("the model's height stands in where Wikidata has none", () => {
  expect(factLines(null, 23.6)).toEqual(["24 m"]);
  expect(factLines(null, 0.4)).toEqual([]);
  expect(factLines(FRAUENKIRCHE, 60)).toContain("wiederaufgebaut 2005 · 91 m");
});

test("an ensemble takes the landmark with the most to say", () => {
  const thin: LandmarkFactsEntry = {
    id: "Q2",
    name: "Museum",
    buildings: ["DESN_a"],
    height: 20,
  };
  const index = indexLandmarkFacts({
    attribution: "Wikidata (CC0)",
    landmarks: [{ ...FRAUENKIRCHE, buildings: ["DESN_b"] }, thin],
  });
  expect(factsFor(index, ["DESN_a", "DESN_b"])?.id).toBe("Q157229");
  expect(factsFor(index, ["DESN_a"])?.id).toBe("Q2");
  expect(factsFor(index, ["DESN_none"])).toBeNull();
});

test("the item named as the card names it wins on a shared Building", () => {
  const school: LandmarkFactsEntry = {
    id: "Q9",
    name: "Hochschule für Bildende Künste",
    buildings: ["DESN_fk"],
    built: [1764],
    architects: ["A", "B"],
    height: 30,
    rebuilt: [1950],
  };
  const index = indexLandmarkFacts({
    attribution: "",
    landmarks: [school, FRAUENKIRCHE],
  });
  expect(index.get("DESN_fk")?.length).toBe(2);
  expect(factsFor(index, ["DESN_fk"], "Frauenkirche")?.id).toBe("Q157229");
  expect(factsFor(index, ["DESN_fk"], " frauenkirche ")?.id).toBe("Q157229");
  // no name to go by: the one with the most to say
  expect(factsFor(index, ["DESN_fk"])?.id).toBe("Q9");
});

test("the file is checked before it is read", () => {
  expect(
    isLandmarkFactsFile({ attribution: "a", landmarks: [FRAUENKIRCHE] })
  ).toBe(true);
  expect(isLandmarkFactsFile({ attribution: "a" })).toBe(false);
  expect(
    isLandmarkFactsFile({
      attribution: "a",
      landmarks: [{ ...FRAUENKIRCHE, built: [1, 2, 3] }],
    })
  ).toBe(false);
  expect(
    isLandmarkFactsFile({
      attribution: "a",
      landmarks: [{ ...FRAUENKIRCHE, architects: [3] }],
    })
  ).toBe(false);
});

test("the tileset's extras name the file or not", () => {
  expect(landmarkFactsUrl({ landmarkFacts: "lf.abc.json" })).toBe(
    "lf.abc.json"
  );
  expect(landmarkFactsUrl({ landmarkFacts: "" })).toBeNull();
  expect(landmarkFactsUrl({})).toBeNull();
  expect(landmarkFactsUrl(null)).toBeNull();
});
