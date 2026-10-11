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

test("a landmark in each zone lands where PROJ puts it", () => {
  // PROJ 9.5.1 (pyproj 3.7.2), EPSG:4258 → the site's CRS: another
  // implementation than proj4's below (Poder/Engsager, not Krüger's
  // series), printed to 0.1 mm. PROJ's meridian convergence is grid north
  // from true north, ours the other way round.
  const landmarks = [
    [25_833, 51.051_893, 13.741_522, 411_793.1247, 5_656_349.0498, -0.978_8],
    [25_833, 52.516_275, 13.377_704, 389_918.0415, 5_819_699.1323, -1.287_5],
    [25_832, 53.550_556, 9.992_222, 565_737.2899, 5_933_976.0674, 0.798_2],
    [25_832, 48.138_611, 11.573_611, 691_458.0057, 5_334_909.9112, 1.917_3],
  ] as const;
  for (const [epsg, lat, lng, x, y, projConvergence] of landmarks) {
    const there = latLngToUtm(epsg, lat, lng);
    expect(there?.x).toBeCloseTo(x, 3);
    expect(there?.y).toBeCloseTo(y, 3);
    const back = utmToLatLng(epsg, x, y);
    expect(back?.lat).toBeCloseTo(lat, 8);
    expect(back?.lng).toBeCloseTo(lng, 8);
    expect(gridConvergenceDeg(epsg, lat, lng)).toBeCloseTo(-projConvergence, 4);
  }
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
