import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { LEDGER_FILE, viewerReads } from "./ledger";

/** A fine level's extras as the tileset names them (published names). */
const FINE = {
  landcover: "landcover.png",
  landcoverLow: "landcover.r2048.png",
  ndvi: "ndvi.png",
  surface: "surface.png",
  surfaceFar: "surface.r1024.png",
  sport: "sport.png",
  sportFar: "sport.r1024.png",
  sportTable: "sport.json",
  markings: "markings.png",
  markingsLow: "markings_low.png",
  markingsTable: "markings.json",
  svf: "svf.png",
};

test("the ledger reads a level's rasters by the viewer's own rule", () => {
  const desktop = viewerReads(FINE, 0, false);
  expect(desktop.toSorted()).toEqual(
    [
      "landcover.png",
      "markings.json",
      "markings.png",
      "ndvi.png",
      "sport.json",
      "sport.png",
      "surface.png",
      "svf.png",
    ].toSorted()
  );
  const phone = viewerReads(FINE, 0, true);
  // a phone's class raster and markings are the twins; no sports raster
  expect(phone).toContain("landcover.r2048.png");
  expect(phone).toContain("markings_low.png");
  expect(phone).not.toContain("landcover.png");
  expect(phone).not.toContain("sport.png");
  // a coarse level reads no sports grounds on any tier
  expect(viewerReads(FINE, 1, false)).not.toContain("sport.png");
});

test("the ledger is committed", () => {
  expect(existsSync(LEDGER_FILE)).toBe(true);
});
