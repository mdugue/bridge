import { expect, test } from "bun:test";
import {
  compassToward,
  hamburgBikeUrl,
  intervalEnd,
  parseHamburgBikes,
} from "./bike-feeds";
import { latLngToUtm } from "./crs";

// Hamburg's site: zone 32
const EPSG = 25_832;
const BOUNDS = [564_000, 5_932_000, 568_000, 5_936_000] as const;

const stream = (
  direction: string,
  richtung: string,
  result: number,
  lng: number,
  lat: number,
  arm = "6"
) => ({
  properties: { assetID: "6408", direction, knotenarm: arm },
  Thing: {
    properties: { richtung },
    Locations: [
      { location: { geometry: { type: "Point", coordinates: [lng, lat] } } },
    ],
  },
  Observations: [
    { result, phenomenonTime: "2026-10-01T10:00:00Z/2026-10-01T10:59:59Z" },
  ],
});

test("the request asks for the hourly bicycle streams inside the site", () => {
  const url = new URL(hamburgBikeUrl(BOUNDS, EPSG));
  const filter = url.searchParams.get("$filter") ?? "";
  expect(filter).toContain("HH_STA_Verkehrsdaten_Rad_Infrarotdetektoren");
  expect(filter).toContain("'P1H'");
  // the box in WGS84, lng before lat, around the Binnenalster
  expect(filter).toMatch(/POLYGON\(\(9\.9\d+ 53\.5\d+/u);
  expect(url.searchParams.get("$expand")).toContain("Observations($top=1");
});

test("a counting point's directions become one counter at its total's place", () => {
  const doc = {
    value: [
      stream("0", "Keine Richtung", 248, 9.989954, 53.559573),
      stream("1", "Nord nach Süd", 139, 9.989791, 53.559602),
      stream("2", "Süd nach Nord", 109, 9.990116, 53.559537),
      // nothing measured: left out
      {
        ...stream("1", "Ost nach West", 3, 9.99, 53.55, "2"),
        Observations: [],
      },
    ],
  };
  const counters = parseHamburgBikes(doc, BOUNDS, EPSG);
  expect(counters).toHaveLength(1);
  const [c] = counters;
  expect(c.directions).toEqual([
    { toward: "Süd", count: 139 },
    { toward: "Nord", count: 109 },
  ]);
  const at = latLngToUtm(EPSG, 53.559573, 9.989954);
  expect(c.x).toBeCloseTo(at?.x ?? 0, 3);
  expect(c.y).toBeCloseTo(at?.y ?? 0, 3);
  // a north–south street: its angle is north
  expect(c.angleDeg % 180).toBe(0);
  expect(c.measuredAt?.toISOString()).toBe("2026-10-01T11:00:00.000Z");
  expect(c.id).toBe("6408-6");
});

test("a counter outside the site, or a malformed answer, is left out", () => {
  const far = { value: [stream("1", "Nord nach Süd", 5, 10.5, 53.6)] };
  expect(parseHamburgBikes(far, BOUNDS, EPSG)).toEqual([]);
  expect(parseHamburgBikes(null, BOUNDS, EPSG)).toEqual([]);
  expect(parseHamburgBikes({ value: "no" }, BOUNDS, EPSG)).toEqual([]);
});

test("a null or a number among the streams is left out, the others read", () => {
  const doc = {
    value: [
      null,
      stream("1", "Nord nach Süd", 139, 9.989791, 53.559602),
      7,
      { Thing: null, Observations: [null], properties: null },
    ],
  };
  const counters = parseHamburgBikes(doc, BOUNDS, EPSG);
  expect(counters).toHaveLength(1);
  expect(counters[0].directions).toEqual([{ toward: "Süd", count: 139 }]);
});

test("compass names and intervals read as the counters write them", () => {
  expect(compassToward("Südwest nach Nordost")).toBe("Nordost");
  expect(compassToward("Keine Richtung")).toBe("");
  expect(intervalEnd("garbage")).toBeNull();
});
