import { describe, expect, test } from "bun:test";
import { latLngToUtm, utmToLatLng } from "./crs";
import {
  deviceAim,
  deviceHeadingDeg,
  devicePitchDeg,
  distanceOutside,
  easeAngleDeg,
  normalizeDeg,
  placementOf,
} from "./geolocation";
import type { TerrainBounds } from "./terrain-geometry";

const near = (a: number | null, b: number, eps = 1e-6) => {
  expect(a).not.toBeNull();
  // Compare on the circle: 359.9° is next to 0°.
  const d = Math.abs(normalizeDeg((a ?? 0) - b + 180) - 180);
  expect(d).toBeLessThan(eps);
};

describe("deviceHeadingDeg", () => {
  test("flat on the table, the top edge is the heading", () => {
    near(deviceHeadingDeg(0, 0, 0), 0);
    // alpha turns counter-clockwise: 90 = the top points west.
    near(deviceHeadingDeg(90, 0, 0), 270);
    near(deviceHeadingDeg(270, 0, 0), 90);
  });

  test("held upright, the back camera is the heading", () => {
    near(deviceHeadingDeg(0, 90, 0), 0);
    near(deviceHeadingDeg(90, 90, 0), 270);
    near(deviceHeadingDeg(200, 70, 0), 160);
  });

  test("tilted past vertical, the camera still wins", () => {
    near(deviceHeadingDeg(0, 110, 0), 0);
  });

  test("landscape: screen up is the device's side", () => {
    // Flat, rotated to landscape-primary (screen angle 90): the screen's top
    // is the device's right edge, 90° clockwise of its top.
    near(deviceHeadingDeg(0, 0, 0, 90), 90);
    near(deviceHeadingDeg(0, 0, 0, 270), 270);
    // Upright in landscape (top edge pointing north, rolled onto its side by
    // gamma −90): the screen's up is the sky, the camera looks east.
    near(deviceHeadingDeg(0, 0, -90, 90), 90);
  });
});

describe("distanceOutside", () => {
  const b: TerrainBounds = [0, 0, 100, 100];
  test("zero inside, straight-line distance outside", () => {
    expect(distanceOutside(b, 50, 50)).toBe(0);
    expect(distanceOutside(b, 100, 0)).toBe(0);
    expect(distanceOutside(b, 130, 50)).toBe(30);
    expect(distanceOutside(b, -30, -40)).toBe(50);
  });
});

describe("placementOf", () => {
  // The Dresden spawn tile, 33412_5656.
  const bounds: TerrainBounds = [412_000, 5_656_000, 414_000, 5_658_000];
  const inside = utmToLatLng(25_833, 413_000, 5_657_000);
  if (!inside) {
    throw new Error("proj4 unavailable");
  }

  test("a fix on the site lands on its projected coordinates", () => {
    const p = placementOf(
      { ...inside, accuracy: 12, headingDeg: 45 },
      25_833,
      bounds
    );
    expect(p.kind).toBe("inside");
    if (p.kind !== "inside") {
      return;
    }
    expect(p.epsgX).toBeCloseTo(413_000, 3);
    expect(p.epsgY).toBeCloseTo(5_657_000, 3);
    expect(p.accuracy).toBe(12);
    // True north lies ~1° east of grid north west of the central meridian.
    expect(p.headingDeg).toBeGreaterThan(45.5);
    expect(p.headingDeg).toBeLessThan(46.5);
  });

  test("a grid bearing is a bearing along the projected grid", () => {
    // Walk 1 km towards true bearing 45°; the grid bearing of that step must
    // match what placementOf reports for a 45° compass reading.
    const p = placementOf(
      { ...inside, accuracy: 5, headingDeg: 0 },
      25_833,
      bounds
    );
    const north = latLngToUtm(25_833, inside.lat + 0.01, inside.lng);
    if (p.kind !== "inside" || !north) {
      throw new Error("expected an inside placement");
    }
    const grid =
      (Math.atan2(north.x - p.epsgX, north.y - p.epsgY) * 180) / Math.PI;
    expect(p.headingDeg ?? Number.NaN).toBeCloseTo(grid, 2);
  });

  test("no compass keeps the heading open", () => {
    const p = placementOf(
      { ...inside, accuracy: 5, headingDeg: null },
      25_833,
      bounds
    );
    expect(p.kind === "inside" && p.headingDeg).toBeNull();
  });

  test("a fix off the site reports how far off", () => {
    const berlin = { lat: 52.52, lng: 13.405, accuracy: 20, headingDeg: 0 };
    const p = placementOf(berlin, 25_833, bounds);
    expect(p.kind).toBe("outside");
    if (p.kind === "outside") {
      expect(p.distanceM).toBeGreaterThan(150_000);
      expect(p.distanceM).toBeLessThan(170_000);
    }
  });
});

describe("devicePitchDeg / deviceAim", () => {
  test("upright is level, flat looks down, tilted back looks up", () => {
    expect(devicePitchDeg(90, 0)).toBeCloseTo(0, 6);
    expect(devicePitchDeg(0, 0)).toBeCloseTo(-90, 6);
    expect(devicePitchDeg(110, 0)).toBeCloseTo(20, 6);
    expect(devicePitchDeg(60, 0)).toBeCloseTo(-30, 6);
    // Upright in landscape: rolled on its side, level.
    expect(devicePitchDeg(0, -90)).toBeCloseTo(0, 6);
  });

  test("the aim pairs the heading with the pitch", () => {
    const aim = deviceAim(270, 75, 0);
    near(aim?.headingDeg ?? null, 90);
    expect(aim?.pitchDeg).toBeCloseTo(-15, 6);
  });
});

describe("easeAngleDeg", () => {
  test("eases the short way round", () => {
    expect(easeAngleDeg(0, 90, 0.5)).toBeCloseTo(45, 9);
    near(normalizeDeg(easeAngleDeg(350, 10, 0.5)), 0, 1e-9);
    near(normalizeDeg(easeAngleDeg(10, 350, 1)), 350, 1e-9);
  });
});
