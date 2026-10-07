import { expect, test } from "bun:test";
import {
  acrossStreet,
  bikeColumnHeight,
  bikeCountsUrl,
  countClock,
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
  // 07:00 in Dresden (CEST)
  expect(c.measuredAt?.toISOString()).toBe("2026-10-01T05:00:00.000Z");
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

test("a null or a number among the features is left out, the others read", () => {
  const counters = parseBikeCounts(
    { features: [null, counter({}), 3, "x"] },
    SITE
  );
  expect(counters.map((c) => c.name)).toEqual(["Albertbrücke"]);
});

test("the time is Dresden's wall clock, whatever the visitor's zone; anything else is no time", () => {
  // winter (CET, +1) and summer (CEST, +2)
  expect(parseCountTime("24.12.2026 18:00:00")?.toISOString()).toBe(
    "2026-12-24T17:00:00.000Z"
  );
  expect(parseCountTime("24.06.2026 18:00:00")?.toISOString()).toBe(
    "2026-06-24T16:00:00.000Z"
  );
  // either side of the spring and autumn switches (29.03. and 25.10.2026)
  expect(parseCountTime("29.03.2026 01:30:00")?.toISOString()).toBe(
    "2026-03-29T00:30:00.000Z"
  );
  expect(parseCountTime("29.03.2026 03:30:00")?.toISOString()).toBe(
    "2026-03-29T01:30:00.000Z"
  );
  expect(parseCountTime("25.10.2026 04:00:00")?.toISOString()).toBe(
    "2026-10-25T03:00:00.000Z"
  );
  expect(parseCountTime("gestern")).toBeNull();
});

test("a count's time is shown on the city's clock, whatever the visitor's zone", () => {
  // run under any TZ but Berlin's (TZ=Asia/Tokyo) a local clock fails this
  expect(countClock(parseCountTime("01.10.2026 07:00:00") as Date)).toBe(
    "07:00"
  );
  expect(countClock(new Date("2026-12-24T17:00:00Z"))).toBe("18:00");
});

test("an old count is stale", () => {
  const [c] = parseBikeCounts({ features: [counter({})] }, SITE);
  // 07:00 in Dresden is 05:00 UTC
  expect(isStale(c, new Date(Date.UTC(2026, 9, 1, 6, 10)))).toBe(false);
  expect(isStale(c, new Date(Date.UTC(2026, 9, 1, 9, 30)))).toBe(true);
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
