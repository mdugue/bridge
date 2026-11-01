import { describe, expect, test } from "bun:test";
import {
  designSize,
  scaleBox,
  scaleHint,
  scaleMetres,
  beyondExtents,
  elsewhereFrame,
  elsewhereNote,
  type DesignBox,
  designAnchor,
  detectGeoreference,
  groundBase,
  normalizeRotation,
  parsePlacementFile,
  placeAhead,
  placedCorners,
  placementFile,
  placePoint,
  standingBase,
  trustedBase,
  utmZone,
} from "./design-placement";
import type { TerrainBounds } from "./terrain-geometry";

const local: DesignBox = { min: [-10, 0, -5], max: [10, 12, 5] };

describe("design placement", () => {
  test("zones of ETRS89/UTM codes", () => {
    expect(utmZone(25_833)).toBe(33);
    expect(utmZone(25_832)).toBe(32);
    expect(utmZone(4326)).toBeNull();
  });

  test("a design about its own origin has no georeference", () => {
    expect(detectGeoreference(local, 25_833)).toBeNull();
  });

  test("UTM in X and −Z is read as the place, NHN heights kept", () => {
    const box: DesignBox = {
      min: [412_490, 112, -5_656_510],
      max: [412_510, 130, -5_656_490],
    };
    expect(detectGeoreference(box, 25_833)).toEqual({
      east: 412_500,
      north: 5_656_500,
      base: 112,
      zonePrefixed: false,
    });
  });

  test("an easting with the zone in front loses it", () => {
    const box: DesignBox = {
      min: [33_412_490, 0, -5_656_510],
      max: [33_412_510, 20, -5_656_490],
    };
    const geo = detectGeoreference(box, 25_833);
    expect(geo?.east).toBe(412_500);
    expect(geo?.zonePrefixed).toBe(true);
    // another zone's prefix is no easting of this one
    expect(detectGeoreference(box, 25_832)).toBeNull();
  });

  test("a northing in +Z (a mirrored export) is not taken", () => {
    const box: DesignBox = {
      min: [412_490, 0, 5_656_490],
      max: [412_510, 20, 5_656_510],
    };
    expect(detectGeoreference(box, 25_833)).toBeNull();
  });

  test("an own base far from the ground gives way to the ground", () => {
    expect(trustedBase(112, 110)).toBe(112);
    expect(trustedBase(0, 110)).toBe(110);
    expect(trustedBase(null, 110)).toBe(110);
    expect(trustedBase(112, null)).toBe(112);
  });

  test("the anchor is the box's middle in plan at its foot", () => {
    expect(designAnchor({ min: [0, -2, -10], max: [20, 8, 0] })).toEqual([
      10, -2, -5,
    ]);
  });

  test("a compass turn takes the design's north to the east", () => {
    const at = { east: 1000, north: 2000, base: 100, rotation: 90 };
    // 10 m north of the anchor in the design's frame (−z)
    const p = placePoint(at, [0, 3, -10]);
    expect(p.x).toBeCloseTo(1010, 9);
    expect(p.y).toBeCloseTo(2000, 9);
    expect(p.z).toBe(103);
    // unturned, north stays north
    const q = placePoint({ ...at, rotation: 0 }, [0, 0, -10]);
    expect(q.x).toBeCloseTo(1000, 9);
    expect(q.y).toBeCloseTo(2010, 9);
  });

  test("the box's corners turn about the anchor", () => {
    const corners = placedCorners(
      { east: 0, north: 0, base: 0, rotation: 0 },
      local
    );
    expect(corners).toEqual([
      [-10, -5],
      [10, -5],
      [10, 5],
      [-10, 5],
    ]);
  });

  test("set on the ground at the lowest ground under it", () => {
    // ground rising to the east by 1 m per 10 m
    const heightAt = (x: number) => 100 + x / 10;
    const base = groundBase(
      { east: 0, north: 0, rotation: 0 },
      local,
      heightAt
    );
    expect(base).toBeCloseTo(99, 9);
    expect(
      groundBase({ east: 0, north: 0, rotation: 0 }, local, () => null)
    ).toBeNull();
  });

  test("a model drawn about its ground floor stands on its ±0", () => {
    // a basement 4 m below ±0
    expect(standingBase({ min: [0, -4, 0], max: [1, 20, 1] }, 110)).toBe(106);
    // nothing below its origin: its lowest point on the ground
    expect(standingBase({ min: [0, 0, 0], max: [1, 20, 1] }, 110)).toBe(110);
    expect(standingBase({ min: [0, 2, 0], max: [1, 20, 1] }, 110)).toBe(110);
  });

  test("set down ahead of the player, clear of them", () => {
    const at = placeAhead({ epsgX: 0, epsgY: 0, heading: Math.PI / 2 }, local);
    expect(at.east).toBeCloseTo(Math.hypot(10, 5) + 15, 9);
    expect(at.north).toBeCloseTo(0, 9);
  });

  test("turns stay in (−180, 180]", () => {
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(540)).toBe(180);
    expect(normalizeRotation(-45)).toBe(-45);
  });

  test("a placement file round-trips and refuses another Land's", () => {
    const placement = {
      east: 411_234.5678,
      north: 5_657_890.1234,
      base: 113.2049,
      rotation: 12.345,
    };
    const text = placementFile(placement, 25_833, "haus.glb");
    const back = parsePlacementFile(text, 25_833);
    expect(back).toEqual({
      placement: {
        east: 411_234.568,
        north: 5_657_890.123,
        base: 113.205,
        rotation: 12.35,
      },
      scale: { unit: "m", factor: 1 },
    });
    expect("error" in parsePlacementFile(text, 25_832)).toBe(true);
    expect("error" in parsePlacementFile("{", 25_833)).toBe(true);
    expect("error" in parsePlacementFile('{"format":"x"}', 25_833)).toBe(true);
  });
});

describe("a place the file gives that no one would see", () => {
  test("how far a point lies beyond the nearest tile", () => {
    const tiles: TerrainBounds[] = [
      [412_000, 5_656_000, 414_000, 5_658_000],
      [414_000, 5_656_000, 416_000, 5_658_000],
    ];
    expect(beyondExtents(tiles, 413_000, 5_657_000)).toBe(0);
    expect(beyondExtents(tiles, 417_000, 5_657_000)).toBe(1000);
    // the HHS office's IfcSite, read in zone 33
    expect(beyondExtents(tiles, 245_799, 5_336_744)).toBeGreaterThan(300_000);
  });

  test("a box far from its own origin is in another place's coordinates", () => {
    expect(elsewhereFrame({ min: [-10, 0, -10], max: [10, 9, 10] })).toBe(
      false
    );
    // Karlsruhe's FZK-Haus, placed by its IfcSite in zone 33
    expect(
      elsewhereFrame({
        min: [-38_000, 110, -5_430_000],
        max: [-37_990, 120, -5_429_990],
      })
    ).toBe(true);
  });

  test("the note says how far", () => {
    expect(elsewhereNote(412_000)).toContain("412 km außerhalb");
    expect(elsewhereNote(null)).toContain("anderen Orts");
  });
});

describe("a design's scale", () => {
  test("a placement file keeps the unit and factor, an old one none", () => {
    const placement = {
      east: 411_000,
      north: 5_657_000,
      base: 110,
      rotation: 0,
    };
    const text = placementFile(placement, 25_833, "haus.obj", {
      unit: "cm",
      factor: 2,
    });
    const back = parsePlacementFile(text, 25_833);
    expect("scale" in back && back.scale).toEqual({ unit: "cm", factor: 2 });
    // a file from before the scale was kept leaves the design's as it is
    const old = text
      .replace(/,\s*"unit": "cm",\s*"factor": 2/, "")
      .replace("entwurf/2", "entwurf/1");
    const before = parsePlacementFile(old, 25_833);
    expect("scale" in before && before.scale).toBeNull();
    const bad = text.replace('"cm"', '"furlong"');
    expect("error" in parsePlacementFile(bad, 25_833)).toBe(true);
  });

  test("a unit and factor in metres", () => {
    expect(scaleMetres({ unit: "mm", factor: 1 })).toBe(0.001);
    expect(scaleMetres({ unit: "cm", factor: 10 })).toBeCloseTo(0.1, 12);
  });

  test("a box scales about its foot, which stays", () => {
    const box: DesignBox = { min: [10, 100, -4], max: [14, 103, 0] };
    const big = scaleBox(box, 10);
    expect(big.min[1]).toBe(100);
    expect((big.min[0] + big.max[0]) / 2).toBe(12);
    expect((big.min[2] + big.max[2]) / 2).toBe(-2);
    expect(designSize(big)).toEqual([40, 40, 30]);
  });

  test("a size far from a building's says so", () => {
    // Kenney's skyscraper in its own units: 1.4 × 1.4 × 2.9
    const kenney: DesignBox = {
      min: [-0.68, 0, -0.68],
      max: [0.68, 2.88, 0.68],
    };
    expect(scaleHint(kenney)).toContain("2,9 m");
    // a 30 m house in millimetres
    const mm: DesignBox = { min: [0, 0, 0], max: [30_000, 12_000, 20_000] };
    expect(scaleHint(mm)).toContain("30 km");
    expect(scaleHint({ min: [0, 0, 0], max: [30, 12, 20] })).toBeNull();
  });
});
