import { expect, test } from "bun:test";
import { SITES } from "../sites";
import {
  daysSince,
  httpDay,
  newerStand,
  osmDataDays,
  report,
  SERVICES,
  snKachel,
} from "./open-data-watch";

test("a GeoSN Kachel is the tile's easting and northing in km", () => {
  expect(snKachel({ e: 412, n: 5656 })).toBe("4125656");
});

test("a Stand is newer by its latest day, LoD2's by its leading year", () => {
  expect(newerStand("2024-11-27, 2024-11-30", "2025-03-01")).toBe(true);
  expect(newerStand("2024-11-27, 2024-11-30", "2024-11-30")).toBe(false);
  // the service and the record write LoD2's differently; its own year counts
  expect(
    newerStand(
      "2024 (LSC: 2016, Basis-DLM: 2022, DGM: 2016)",
      "2025( LSC: 2016, Basis-DLM: 2024, DGM: 2016 )"
    )
  ).toBe(true);
  expect(
    newerStand(
      "2024 (LSC: 2016, Basis-DLM: 2022, DGM: 2016)",
      "2024( LSC: 2016, Basis-DLM: 2022, DGM: 2016 )"
    )
  ).toBe(false);
  // nothing recorded is not 'newer': it is listed to record
  expect(newerStand(undefined, "2025-03-01")).toBe(false);
});

test("the OSM data's days are its dataAsOf days, past the overpass history", () => {
  expect(
    osmDataDays({
      overpass: { lamps: { dataAsOf: "2026-01-01" } },
      geofabrik: { walls: { dataAsOf: "2026-06-15 (re-baked 2026-09-24)" } },
      bbbike: {
        osmBuildings: { dataAsOf: "2026-10-17 (re-baked 2026-10-19)" },
      },
      retrieved: "2026-10-20",
    })
  ).toEqual({ oldest: "2026-06-15", newest: "2026-10-17" });
  expect(osmDataDays(undefined)).toBeNull();
  expect(httpDay("Sat, 24 Oct 2026 16:58:41 GMT")).toBe("2026-10-24");
  expect(httpDay("not a date")).toBeNull();
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
