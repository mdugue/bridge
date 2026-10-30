import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SITES } from "../../sites";
import { SURFACE_ALONG_PERIOD } from "./landcover";
import {
  cycleLineFromKerb,
  LANE_BITS,
  MARKING_OFFSET_SCALE,
  MARKING_KINDS,
  MARKING_PATTERN,
  type MarkingTable,
  markingKindId,
  packMarkingTable,
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

test("every along-street pattern divides the paving raster's period", () => {
  for (const period of [
    MARKING_PATTERN.centrePeriod,
    MARKING_PATTERN.cyclePeriod,
  ]) {
    const k = SURFACE_ALONG_PERIOD / period;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
  }
});

test("a cycle line sits at its kind's distance, past a parking lane", () => {
  const advisory = LANE_BITS.cycle;
  const exclusive = LANE_BITS.cycle | LANE_BITS.cycleSolid;
  const wide = exclusive | LANE_BITS.cycleWide;
  expect(cycleLineFromKerb(advisory, null)).toBe(1.5);
  expect(cycleLineFromKerb(exclusive, null)).toBe(
    MARKING_PATTERN.cycleFromKerb
  );
  expect(cycleLineFromKerb(wide, null)).toBe(2.25);
  // parallel bays on the carriageway push it out by their depth, half on
  // the kerb by a metre less, on the kerb not at all
  expect(cycleLineFromKerb(advisory, [0, 2])).toBe(3.5);
  expect(cycleLineFromKerb(advisory, [-1, 1])).toBe(2.5);
  expect(cycleLineFromKerb(advisory, [-2, 0])).toBe(1.5);
});

test("the lane bits are one bit each and keep the kerb's", () => {
  const bits = Object.values(LANE_BITS);
  expect(new Set(bits).size).toBe(bits.length);
  for (const b of bits) {
    expect(b & (b - 1)).toBe(0);
    expect(b).toBeLessThan(256);
  }
  expect(LANE_BITS.kerb).toBe(8);
  expect(LANE_BITS.centre).toBe(4);
  expect(LANE_BITS.cycle).toBe(1);
});

test("the bake writes the bits and the offset scale the shader reads", () => {
  // pipeline/bake/markings.py packs them into the raster's G and B channels
  const python = readFileSync(join(ROOT, "pipeline/bake/markings.py"), "utf8");
  const scale = python.match(/^EDGE_SCALE = ([\d.]+)/mu)?.[1];
  expect(Number(scale)).toBe(MARKING_OFFSET_SCALE);
  const bits = new Map<string, number>();
  for (const line of python.split("\n")) {
    const m = line.match(/^([A-Z_, ]+) = ([\d, ]+?)\s*(?:#.*)?$/u);
    if (!m) {
      continue;
    }
    const names = m[1].split(",").map((n) => n.trim());
    const values = m[2].split(",").map((v) => Number(v.trim()));
    if (names.length === values.length) {
      names.forEach((n, i) => bits.set(n, values[i]));
    }
  }
  expect({
    cycle: bits.get("CYCLE"),
    cycleSolid: bits.get("CYCLE_SOLID"),
    centre: bits.get("CENTRE"),
    kerb: bits.get("KERB"),
    centreSolid: bits.get("CENTRE_SOLID"),
    laneLines: bits.get("LANE_LINES"),
    red: bits.get("RED"),
    cycleWide: bits.get("CYCLE_WIDE"),
  }).toEqual({ ...LANE_BITS });
});
