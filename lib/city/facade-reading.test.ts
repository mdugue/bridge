import { expect, test } from "bun:test";
import {
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_SHOP,
} from "./city-mesh";
import {
  applyFacadeReadings,
  FACADE_UNIT,
  withFacadeReading,
} from "./facade-reading";

test("a reading rides above the OSM flags and keeps them", () => {
  const osm = OBJECT_FLAG_HERITAGE + OBJECT_FLAG_FLAT_ROOF;
  const flags = withFacadeReading(osm, [3, 2, 0]);
  expect(flags % FACADE_UNIT).toBe(osm);
  expect(Math.floor(flags / FACADE_UNIT)).toBe(3 + 4 * 2);
  // the column is 16 bits wide
  expect(withFacadeReading(511, [3, 3, 1])).toBeLessThan(65_536);
  expect(withFacadeReading(0, [3, 3, 1]) % FACADE_UNIT).toBe(0);
});

test("a shop sign is a bit of its own, and a new reading replaces the old", () => {
  const signed = withFacadeReading(OBJECT_FLAG_SHOP, [1, 1, 1]);
  expect(signed).toBe(OBJECT_FLAG_SHOP + FACADE_UNIT * (1 + 4 + 16));
  expect(withFacadeReading(withFacadeReading(0, [3, 3, 0]), [1, 0, 0])).toBe(
    FACADE_UNIT
  );
  expect(withFacadeReading(FACADE_UNIT * 7 + 2, undefined)).toBe(2);
});

test("every part of a building takes the building's reading", () => {
  const flags = Uint16Array.from([0, 0, 2]);
  const ids = ["a", "a", "b"];
  const changed = applyFacadeReadings(flags, (i) => ids[i], {
    attribution: "",
    buildings: { a: [2, 1, 0] },
  });
  expect(changed).toBe(true);
  expect([...flags]).toEqual([FACADE_UNIT * 6, FACADE_UNIT * 6, 2]);
});
