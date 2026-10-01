import { expect, test } from "bun:test";
import {
  acrossStreet,
  bikeColumnHeight,
  bikeCountsUrl,
  isStale,
  parseBikeCounts,
  parseCountTime,
  towardOf,
} from "./bike-counts";

const SITE = [408_000, 5_654_000, 418_000, 5_660_000] as const;

const counter = (
  props: Record<string, unknown>,
  xy = [412_610, 5_657_020]
) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: xy },
  properties: {
    fremd_id: "F01092",
    bezeichnung: "Albertbrücke",
    lage: "in Höhe Rosa-Luxemburg-Platz",
    r1: "Richtung Nord - Neustadt",
    w1: 309,
    r2: "Richtung Süd - Altstadt",
    w2: 482,
    messzeit: "01.10.2026 07:00:00",
    winkel: 25,
    inaktiv: "0",
    ...props,
  },
});

test("the request asks for the live counts in the site's CRS, as GeoJSON", () => {
  const url = new URL(bikeCountsUrl(25_833));
  expect(url.searchParams.get("TypeNames")).toBe("cls:L1781");
  expect(url.searchParams.get("srsName")).toBe("urn:ogc:def:crs:EPSG::25833");
  expect(url.searchParams.get("outputFormat")).toBe("application/geo+json");
});

test("a counter with both directions, its hour and its street", () => {
  const [c, ...rest] = parseBikeCounts({ features: [counter({})] }, SITE);
  expect(rest).toHaveLength(0);
  expect(c.name).toBe("Albertbrücke");
  expect(c.directions).toEqual([
    { toward: "Nord - Neustadt", count: 309 },
    { toward: "Süd - Altstadt", count: 482 },
  ]);
  expect(c.measuredAt?.getHours()).toBe(7);
  expect(c.measuredAt?.getDate()).toBe(1);
  expect(c.angleDeg).toBe(25);
});

test("a direction the counter does not have is left out; a twin is numbered", () => {
  const [c] = parseBikeCounts(
    {
      features: [
        counter({ bezeichnung: "Albertbrücke_1", r2: "Richtung ", w2: 0 }),
      ],
    },
    SITE
  );
  expect(c.name).toBe("Albertbrücke 2");
  expect(c.directions).toHaveLength(1);
  expect(towardOf("Richtung -")).toBe("");
});

test("off the site, inactive or malformed counters are dropped, never thrown", () => {
  const counters = parseBikeCounts(
    {
      features: [
        counter({}, [400_000, 5_657_000]),
        counter({ inaktiv: "1" }),
        { geometry: null, properties: {} },
        counter({ w1: "viele", r2: "Richtung " }),
      ],
    },
    SITE
  );
  expect(counters).toEqual([]);
  expect(parseBikeCounts(null, SITE)).toEqual([]);
  expect(parseBikeCounts({ features: "no" }, SITE)).toEqual([]);
});

test("the time is read as local time; anything else is no time", () => {
  const t = parseCountTime("24.12.2026 18:00:00");
  expect(t?.getFullYear()).toBe(2026);
  expect(t?.getMonth()).toBe(11);
  expect(t?.getHours()).toBe(18);
  expect(parseCountTime("gestern")).toBeNull();
});

test("an old count is stale", () => {
  const [c] = parseBikeCounts({ features: [counter({})] }, SITE);
  expect(isStale(c, new Date(2026, 9, 1, 8, 10))).toBe(false);
  expect(isStale(c, new Date(2026, 9, 1, 11, 30))).toBe(true);
});

test("a column grows with the root of its count, a stub at none", () => {
  expect(bikeColumnHeight(0)).toBeCloseTo(1.5, 6);
  expect(bikeColumnHeight(400)).toBeCloseTo(33.5, 6);
  expect(bikeColumnHeight(-5)).toBeCloseTo(1.5, 6);
});

test("across the street is a right angle to its run", () => {
  // the Albertbrücke runs NNW (25° counter-clockwise from north)
  const a = (25 * Math.PI) / 180;
  const along = [-Math.sin(a), Math.cos(a)];
  const across = acrossStreet(25);
  expect(along[0] * across[0] + along[1] * across[1]).toBeCloseTo(0, 9);
  expect(acrossStreet(0)[0]).toBeCloseTo(1, 9);
});
