import { expect, test } from "bun:test";
import { epsgCodeFromReferenceSystem, utmToLatLng } from "./crs";

test("epsgCodeFromReferenceSystem parses the OGC CRS URL of the Saxony tiles", () => {
  expect(
    epsgCodeFromReferenceSystem(
      "http://www.opengis.net/def/crs/EPSG/6.12/25833"
    )
  ).toBe(25_833);
  expect(epsgCodeFromReferenceSystem("urn:ogc:def:crs:EPSG::25832")).toBe(
    25_832
  );
  expect(epsgCodeFromReferenceSystem(undefined)).toBeNull();
  expect(epsgCodeFromReferenceSystem("not a crs")).toBeNull();
});

test("utmToLatLng(25833) puts the Dresden tile center near 51.05N 13.76E", () => {
  const result = utmToLatLng(25_833, 413_000, 5_657_000);
  expect(result).not.toBeNull();
  expect(result?.lat).toBeGreaterThan(50.9);
  expect(result?.lat).toBeLessThan(51.2);
  expect(result?.lng).toBeGreaterThan(13.5);
  expect(result?.lng).toBeLessThan(14.0);
});

test("utmToLatLng returns null for unsupported codes", () => {
  expect(utmToLatLng(4326, 13.7, 51.0)).toBeNull();
});
