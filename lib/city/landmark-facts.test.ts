import { expect, test } from "bun:test";
import {
  factLines,
  factsFor,
  indexLandmarkFacts,
  isLandmarkFactsFile,
  landmarkFactsUrl,
  landmarkFactsSource,
} from "./landmark-facts";
import type { LandmarkFactsEntry } from "./landmark-facts";
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { SITES } from "../../sites";
import { bakeFileProblems } from "./bake-file";
import { LANDMARK_FACTS_FILE_SPEC } from "./landmark-facts-file";
import { siteDataDir } from "./tile";

const ROOT = nodePath.join(import.meta.dir, "..", "..");

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

test("an ensemble takes the landmark the card names, else its only one", () => {
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
  expect(factsFor(index, ["DESN_a", "DESN_b"], "Frauenkirche")?.id).toBe(
    "Q157229"
  );
  // two items, neither named so: no guess
  expect(factsFor(index, ["DESN_a", "DESN_b"], "Georgenbau")).toBeNull();
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
  // no name to go by: whose facts would be a guess
  expect(factsFor(index, ["DESN_fk"])).toBeNull();
});

// The viewer's guard and the build's schema (ADR 0059) agree: what the
// build lets through, the viewer reads; what the schema refuses, the guard
// refuses too.
const committed = Object.values(SITES)
  .map((site) => nodePath.join(ROOT, landmarkFactsSource(siteDataDir(site))))
  .filter((path) => existsSync(path));

test.each(committed)("the guard accepts %s, as its schema does", (path) => {
  const json: unknown = JSON.parse(readFileSync(path, "utf-8"));
  expect(bakeFileProblems(LANDMARK_FACTS_FILE_SPEC, json)).toEqual([]);
  expect(isLandmarkFactsFile(json)).toBe(true);
});

test.each([
  ["no landmarks", { attribution: "a" }],
  ["no attribution", { landmarks: [FRAUENKIRCHE] }],
  ["three years", { built: [1, 2, 3] }],
  ["an architect not named", { architects: [3] }],
  ["no name", { name: undefined }],
  ["a Building not named", { buildings: [1] }],
  ["a year not whole", { rebuiltFrom: 1945.5 }],
  ["a height as text", { height: "91" }],
] as const)("the guard and the schema both refuse %s", (_, broken) => {
  const file =
    "attribution" in broken || "landmarks" in broken
      ? broken
      : { attribution: "a", landmarks: [{ ...FRAUENKIRCHE, ...broken }] };
  expect(bakeFileProblems(LANDMARK_FACTS_FILE_SPEC, file)).not.toEqual([]);
  expect(isLandmarkFactsFile(file)).toBe(false);
});

test("the tileset's extras name the file or not", () => {
  expect(landmarkFactsUrl({ landmarkFacts: "lf.abc.json" })).toBe(
    "lf.abc.json"
  );
  expect(landmarkFactsUrl({ landmarkFacts: "" })).toBeNull();
  expect(landmarkFactsUrl({})).toBeNull();
  expect(landmarkFactsUrl(null)).toBeNull();
});
