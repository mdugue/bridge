import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SITES } from "../../sites";
import { SURFACE_ALONG_PERIOD } from "./landcover";
import {
  MARKING_KINDS,
  MARKING_PATTERN,
  type MarkingTable,
  markingKindId,
  packMarkingTable,
  stripeCoverage,
} from "./markings";
import { sideFileSource, tileArtifacts, tileIds } from "./tile";

const ROOT = join(import.meta.dir, "..", "..");

test("the committed tables name the kinds in the viewer's order", () => {
  let rows = 0;
  // every site whose bakes are on disk (Dresden's are committed)
  for (const site of Object.values(SITES)) {
    for (const tile of tileIds(site)) {
      const file = tileArtifacts(tile).markingsTable.file;
      const path = join(ROOT, sideFileSource(site, file));
      if (!existsSync(path)) {
        continue;
      }
      const doc = JSON.parse(readFileSync(path, "utf8")) as MarkingTable & {
        kinds: Record<string, string>;
      };
      expect(Object.values(doc.kinds)).toEqual([...MARKING_KINDS]);
      for (const [cx, cy, , hl, hw, kind] of doc.markings) {
        // inside the tile (a small margin: a row centred just past the seam)
        expect(cx).toBeGreaterThan(-50);
        expect(cx).toBeLessThan(2050);
        expect(cy).toBeLessThan(50);
        expect(cy).toBeGreaterThan(-2050);
        expect(hl).toBeGreaterThan(0);
        // half the widest carriageway (30 m), and a little more where the
        // bake merged two nodes of one crossing at an angle
        expect(hl).toBeLessThanOrEqual(16);
        expect(hw).toBeGreaterThan(0);
        expect(kind).toBeGreaterThan(0);
        expect(kind).toBeLessThan(MARKING_KINDS.length);
        rows++;
      }
    }
  }
  expect(rows).toBeGreaterThan(0);
});

test("a row packs into two texels, unknown kinds as none", () => {
  const { data, width } = packMarkingTable({
    markings: [
      [10, -20, Math.PI / 2, 5, 2, markingKindId("zebra")],
      [1, -2, 0, 3, 0.25, 9],
    ],
  });
  expect(width).toBe(2);
  expect(data[0]).toBe(10);
  expect(data[1]).toBe(-20);
  expect(data[2]).toBeCloseTo(0, 9);
  expect(data[3]).toBeCloseTo(1, 9);
  expect(Array.from(data.slice(8, 12))).toEqual([5, 2, 1, 0]);
  expect(data[14]).toBe(0);
});

test("stripes average to their share of the period far off", () => {
  expect(stripeCoverage(0.25, 0.5, 1, 0.01)).toBeCloseTo(1, 9);
  expect(stripeCoverage(0.75, 0.5, 1, 0.01)).toBeCloseTo(0, 9);
  for (const x of [0, 0.3, 17.7]) {
    expect(stripeCoverage(x, 0.5, 1, 10)).toBeCloseTo(0.5, 2);
  }
});

test("every along-street pattern divides the paving raster's period", () => {
  for (const period of [
    MARKING_PATTERN.centrePeriod,
    MARKING_PATTERN.cyclePeriod,
  ]) {
    const k = SURFACE_ALONG_PERIOD / period;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
  }
});
