import { expect, test } from "bun:test";
import { SITES } from "../sites";
import {
  daysSince,
  latestDate,
  newerStand,
  report,
  SERVICES,
  snKachel,
} from "./open-data-watch";

test("a GeoSN Kachel is the tile's easting and northing in km", () => {
  expect(snKachel({ e: 412, n: 5656 })).toBe("4125656");
});

test("a Stand is newer by its latest day", () => {
  expect(newerStand("2024-11-27, 2024-11-30", "2025-03-01")).toBe(true);
  expect(newerStand("2024-11-27, 2024-11-30", "2024-11-30")).toBe(false);
  // nothing recorded is not 'newer': it is listed to record
  expect(newerStand(undefined, "2025-03-01")).toBe(false);
});

test("the OSM date is the latest anywhere in the record", () => {
  expect(
    latestDate({ a: "retrieved 2026-09-24", b: { c: "2026-10-19 (re-baked)" } })
  ).toBe("2026-10-19");
  expect(latestDate(undefined)).toBeNull();
  expect(daysSince("2026-10-19", new Date("2026-10-30T12:00:00Z"))).toBe(11);
});

test("every provider a site uses has its services listed", () => {
  for (const site of Object.values(SITES)) {
    expect(SERVICES[site.provider.id]?.length ?? 0).toBeGreaterThan(0);
  }
});

test("the report puts what to act on first", () => {
  const text = report(
    [
      { kind: "osm", act: false, text: "alt genug" },
      { kind: "edition", act: true, text: "neuer Stand" },
    ],
    new Date("2026-10-30T00:00:00Z")
  );
  expect(text.indexOf("neuer Stand")).toBeLessThan(text.indexOf("alt genug"));
  expect(text).toContain("## Zu tun");
});
