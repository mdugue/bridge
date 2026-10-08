import { expect, test } from "bun:test";
import type { CardCredits } from "./card-lines";
import { canopyCard, furnitureCard, hedgeCard, lampCard } from "./inquiry-more";
import type { Stated } from "./methods";

const lines = (sources: readonly Stated[]) => sources.map((l) => l.text);

/** Dresden's credits (sites/providers.ts) as the HUD hands them over. */
const DRESDEN: CardCredits = {
  dlm: true,
  provider: "Quelle: GeoSN, dl-de/by-2-0",
};
/** Hamburg's: no Basis-DLM, its hedges and tree rows are OSM's. */
const HAMBURG: CardCredits = {
  dlm: false,
  provider: "Freie und Hansestadt Hamburg, LGV, dl-de/by-2-0",
};

const at: [number, number] = [411000, 5656000];

test("a tree without a register says what was measured, and no species", () => {
  const card = canopyCard(
    { kind: "canopy", tile: "t", position: at, source: "dom", height: 17.4 },
    null,
    DRESDEN
  );
  expect(card.facts).toContainEqual({
    label: "Höhe",
    value: "17,4 m, gemessen",
  });
  expect(card.facts).toContainEqual({ label: "Art", value: "nicht bekannt" });
  expect(card.sources[0]?.text).toContain("Digitales Oberflächenmodell DOM1");
  // the crown's place is found in the surface, not measured as such
  expect(card.sources[0]?.method).toBe("detected");
  expect(card.address).toBe("Eine Krone, im Oberflächenmodell erkannt");
});

test("a hedge's height is measured only where the laser scan said so", () => {
  const hedge = { kind: "hedge" as const, tile: "t", position: at, length: 42 };
  const scanned = hedgeCard(
    { ...hedge, source: "osm+lsc", height: 2 },
    null,
    DRESDEN
  );
  expect(scanned.facts[0].value).toBe("2 m, gemessen");
  expect(lines(scanned.sources)).toHaveLength(2);
  const tagged = hedgeCard(
    { ...hedge, source: "osm", height: 2 },
    null,
    DRESDEN
  );
  expect(tagged.facts[0].value).toBe("2 m");
});

test("a tree row or hedge credits the site's own source, not GeoSN", () => {
  const row = { kind: "canopy" as const, tile: "t", position: at };
  const dresden = canopyCard({ ...row, source: "row" }, null, DRESDEN);
  expect(dresden.sources[0]?.text).toContain("Basis-DLM");
  expect(dresden.sources[0]?.text).toContain("GeoSN");
  const hamburg = canopyCard({ ...row, source: "row" }, null, HAMBURG);
  expect(hamburg.sources[0]?.text).toContain("OpenStreetMap");
  expect(hamburg.sources[0]?.text).not.toContain("GeoSN");
  const scan = canopyCard({ ...row, source: "lsc" }, null, HAMBURG);
  expect(scan.sources[0]?.text).toContain("LGV");
  const hedge = hedgeCard(
    { kind: "hedge", tile: "t", position: at, length: 12, source: "dlm" },
    null,
    HAMBURG
  );
  expect(hedge.sources[0]?.text).toContain("OpenStreetMap");
});

test("a lamp's post is assumed, and the card says so", () => {
  const card = lampCard({ kind: "lamp", tile: "t", position: at }, null);
  expect(card.facts).toEqual([
    { label: "Mast", value: "5 m, angenommen", method: "assumed" },
  ]);
});

test("a lamp or bin Mapillary detected names Mapillary, not OSM", () => {
  const lamp = lampCard(
    { kind: "lamp", tile: "t", position: at, src: "mly" },
    null
  );
  expect(lamp.sources[0]?.text).toStartWith("Laterne: Mapillary");
  expect(lamp.sources[0]?.text).toContain("CC BY-SA 4.0");
  const bin = furnitureCard(
    {
      kind: "furniture",
      tile: "t",
      position: at,
      properties: { k: "bin", src: "mly" },
    },
    null
  );
  expect(bin.sources[0]?.text).toStartWith("Papierkorb: Mapillary");
  const osmLamp = lampCard({ kind: "lamp", tile: "t", position: at }, null);
  expect(osmLamp.sources[0]?.text).toContain("OpenStreetMap");
});

test("a bench faces where OSM or the nearest way says", () => {
  const card = furnitureCard(
    {
      kind: "furniture",
      tile: "t",
      position: at,
      properties: { k: "bench", a: 225, back: false, l: 2 },
    },
    null
  );
  expect(card.title).toBe("Bank");
  expect(card.facts).toContainEqual({ label: "Lehne", value: "ohne" });
  expect(card.facts).toContainEqual({
    label: "Ausrichtung",
    value: "nach Südwesten",
  });
});
