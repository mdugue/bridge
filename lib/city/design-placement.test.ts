import { describe, expect, test } from "bun:test";
import {
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
    });
    expect("error" in parsePlacementFile(text, 25_832)).toBe(true);
    expect("error" in parsePlacementFile("{", 25_833)).toBe(true);
    expect("error" in parsePlacementFile('{"format":"x"}', 25_833)).toBe(true);
  });
});
