import { expect, test } from "bun:test";
import proj4 from "proj4";
import { SITES } from "@/sites";
import {
  epsgCodeFromReferenceSystem,
  gridConvergenceDeg,
  latLngToUtm,
  utmToLatLng,
} from "./crs";
import { tileExtentOf, utmZoneOf } from "./site";

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

test("unsupported codes project nothing", () => {
  expect(utmToLatLng(4326, 13.7, 51.0)).toBeNull();
  expect(latLngToUtm(4326, 51.0, 13.7)).toBeNull();
  expect(gridConvergenceDeg(4326, 51.0, 13.7)).toBeNull();
});

test("the projection is proj4's over every configured site's tiles", () => {
  // what crs.ts used to hand proj4 (ETRS89 taken as WGS84: no datum shift)
  const def = (epsg: number) =>
    `+proj=utm +zone=${epsg - 25_800} +ellps=GRS80 +units=m +no_defs +type=crs`;
  // proj4's convergence: the grid bearing of a short step north along the
  // meridian, centred on the point (the true tangent, to ~1e-8°)
  const STEP = 1e-5;
  const convergence = (epsg: number, lat: number, lng: number) => {
    const [x0, y0] = proj4("WGS84", def(epsg), [lng, lat - STEP]);
    const [x1, y1] = proj4("WGS84", def(epsg), [lng, lat + STEP]);
    return (Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI;
  };
  const worst = { metres: 0, degrees: 0, convergence: 0 };
  let points = 0;
  for (const site of Object.values(SITES)) {
    const { epsg } = site.provider;
    expect(utmZoneOf(epsg)).toBeOneOf([32, 33]);
    for (const cell of site.tiles) {
      const [minX, minY, maxX, maxY] = tileExtentOf(cell);
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
          const x = minX + ((maxX - minX) * i) / 4;
          const y = minY + ((maxY - minY) * j) / 4;
          const [lng, lat] = proj4(def(epsg), "WGS84", [x, y]);
          const back = utmToLatLng(epsg, x, y);
          const there = latLngToUtm(epsg, lat, lng);
          if (!(back && there)) {
            throw new Error(`EPSG:${epsg} unsupported`);
          }
          worst.degrees = Math.max(
            worst.degrees,
            Math.abs(back.lat - lat),
            Math.abs(back.lng - lng)
          );
          worst.metres = Math.max(
            worst.metres,
            Math.hypot(there.x - x, there.y - y)
          );
          worst.convergence = Math.max(
            worst.convergence,
            Math.abs(
              (gridConvergenceDeg(epsg, lat, lng) ?? Number.NaN) -
                convergence(epsg, lat, lng)
            )
          );
          points++;
        }
      }
    }
  }
  expect(points).toBeGreaterThan(500);
  // they agree to nanometres (both sum Krüger's series to n⁶); the bars
  // are what a fix, the sun and a compass need
  expect(worst.metres).toBeLessThan(1e-3);
  expect(worst.degrees).toBeLessThan(1e-8);
  expect(worst.convergence).toBeLessThan(1e-6);
});
