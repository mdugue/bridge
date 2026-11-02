import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  foldName,
  matchesQuery,
  nearby,
  type RawEntity,
  referencedItems,
  SERVER_WISSEN_DIR,
  wikidataFacts,
  wikidataTime,
  wikipediaUrl,
} from "./stadtwissen";

test("a Wikidata time reads at its precision", () => {
  expect(wikidataTime({ time: "+1726-08-26T00:00:00Z", precision: 11 })).toBe(
    "26.8.1726"
  );
  expect(wikidataTime({ time: "+1743-00-00T00:00:00Z", precision: 9 })).toBe(
    "1743"
  );
  expect(wikidataTime({ time: "+1700-00-00T00:00:00Z", precision: 7 })).toBe(
    "17. Jahrhundert"
  );
  expect(wikidataTime({ time: "-0044-03-15T00:00:00Z", precision: 9 })).toBe(
    "44 v. Chr."
  );
});

const frauenkirche: RawEntity = {
  labels: {
    de: { value: "Frauenkirche" },
    en: { value: "Church of Our Lady" },
  },
  descriptions: { de: { value: "Kirche in Dresden" } },
  sitelinks: { dewiki: { title: "Frauenkirche (Dresden)" } },
  claims: {
    P84: [
      {
        mainsnak: {
          snaktype: "value",
          datavalue: { type: "wikibase-entityid", value: { id: "Q61070" } },
        },
      },
    ],
    P571: [
      {
        rank: "deprecated",
        mainsnak: {
          snaktype: "value",
          datavalue: {
            type: "time",
            value: { time: "+1700-00-00T00:00:00Z", precision: 9 },
          },
        },
      },
      {
        mainsnak: {
          snaktype: "value",
          datavalue: {
            type: "time",
            value: { time: "+1726-00-00T00:00:00Z", precision: 9 },
          },
        },
      },
    ],
    P2048: [
      {
        mainsnak: {
          snaktype: "value",
          datavalue: {
            type: "quantity",
            value: {
              amount: "+91.24",
              unit: "http://www.wikidata.org/entity/Q11573",
            },
          },
        },
      },
    ],
  },
};

test("the excerpt keeps the listed statements in words", () => {
  expect(referencedItems(frauenkirche)).toEqual(["Q61070"]);
  const facts = wikidataFacts(frauenkirche, { Q61070: "George Bähr" });
  expect(facts).toEqual({
    label: "Frauenkirche",
    description: "Kirche in Dresden",
    wiki: "Frauenkirche (Dresden)",
    claims: {
      P84: [{ id: "Q61070", v: "George Bähr" }],
      P571: [{ v: "1726" }],
      P2048: [{ v: "91.24 m" }],
    },
  });
  expect(wikipediaUrl("Frauenkirche (Dresden)")).toBe(
    "https://de.wikipedia.org/wiki/Frauenkirche_(Dresden)"
  );
});

test("search folds umlauts and needs every word", () => {
  expect(foldName("Brühlsche Terrasse, Straße")).toBe(
    "bruehlsche terrasse strasse"
  );
  const entry = { name: "Kügelgenhaus", addr: "Hauptstraße 13" };
  expect(matchesQuery(entry, "kuegelgen hauptstrasse")).toBe(true);
  expect(matchesQuery(entry, "Kügelgen 14")).toBe(false);
  expect(matchesQuery(entry, "  ")).toBe(false);
});

test("nearby sorts by distance within the radius", () => {
  const got = nearby(
    [
      { id: "far", x: 100, y: 0 },
      { id: "near", x: 3, y: 4 },
      { id: "mid", x: 0, y: 20 },
    ],
    0,
    0,
    50
  );
  expect(got.map((e) => [e.id, e.d])).toEqual([
    ["near", 5],
    ["mid", 20],
  ]);
});

test("the chat route reads the server copy where the build writes it", () => {
  const route = readFileSync(
    join(import.meta.dir, "../../app/api/frag/knowledge.ts"),
    "utf8"
  );
  expect(route).toContain(`"${SERVER_WISSEN_DIR}"`);
});
