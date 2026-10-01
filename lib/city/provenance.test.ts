import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DRESDEN } from "../../sites/dresden";
import { UNNA } from "../../sites/unna";
import {
  isSiteProvenance,
  leadingDate,
  parseLod2Stand,
  type ProvenanceRecord,
  siteProvenance,
} from "./provenance";
import { tileIds } from "./tile";

const record = JSON.parse(
  readFileSync(
    join(import.meta.dir, "..", "..", "data", "dresden", "provenance.json"),
    "utf8"
  )
) as ProvenanceRecord;

test("every site tile has the editions its buildings and ground came from", () => {
  const tiles = tileIds(DRESDEN);
  const manifest = siteProvenance(record, tiles, DRESDEN);
  expect(isSiteProvenance(manifest)).toBe(true);
  for (const tile of tiles) {
    const row = manifest.tiles[tile];
    // The file name in the message says which tile lost an edition.
    for (const key of ["lod2", "lsc", "dgm"] as const) {
      expect(`${tile} ${key}: ${row?.[key]}`).toMatch(/: \d{4}/);
    }
  }
  expect(manifest.sources.osm.stand).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(manifest.sources.osm.credit).toContain("OpenStreetMap");
  expect(manifest.sources.lod2.credit).toBe("Quelle: GeoSN, dl-de/by-2-0");
});

test("another site's card credits its own provider, and OSM for its trees", () => {
  const unna = siteProvenance({}, tileIds(UNNA), UNNA);
  expect(unna.sources.lod2.credit).toBe(UNNA.provider.credit);
  expect(unna.sources.lod2.licence).toBe(UNNA.provider.licence);
  expect(unna.sources.trees.credit).toContain("OpenStreetMap");
  // no per-tile editions in its record: the card names the source alone
  expect(Object.values(unna.tiles).every((row) => !row.lod2)).toBe(true);
  // Dresden's register by its holder and licence
  const dresden = siteProvenance(record, tileIds(DRESDEN), DRESDEN);
  expect(dresden.sources.trees.credit).toBe(
    "Landeshauptstadt Dresden, dl-de/by-2-0"
  );
  expect(dresden.sources.trees.licence).toBe("dl-de/by-2-0");
});

test("a LoD2 edition splits into the model year and its inputs' years", () => {
  expect(
    parseLod2Stand("2024 (LSC: 2016, Basis-DLM: 2022, DGM: 2016)")
  ).toEqual({
    model: "2024",
    inputs: { LSC: "2016", "Basis-DLM": "2022", DGM: "2016" },
  });
  expect(parseLod2Stand("2023")).toEqual({ model: "2023", inputs: {} });
});

test("free-text dates yield their leading ISO date only", () => {
  expect(leadingDate("2026-09-26 (first baked 2026-09-25)")).toBe("2026-09-26");
  expect(leadingDate("June 2026")).toBeUndefined();
  expect(leadingDate(undefined)).toBeUndefined();
});

test("a manifest of another version is not read", () => {
  expect(isSiteProvenance({ version: 2, sources: {}, tiles: {} })).toBe(false);
  expect(isSiteProvenance(null)).toBe(false);
});
