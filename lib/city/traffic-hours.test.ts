import { expect, test } from "bun:test";
import {
  TRAFFIC_HOURS,
  trafficFactor,
  trafficFactorAt,
  trafficSpeed,
} from "./traffic-hours";

test("each day's hours share the whole day", () => {
  for (const hours of Object.values(TRAFFIC_HOURS)) {
    expect(hours).toHaveLength(24);
    expect(hours.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  }
});

test("the average over a day is the average hour", () => {
  for (const kind of ["weekday", "saturday", "sunday"] as const) {
    let sum = 0;
    const steps = 24 * 60;
    for (let i = 0; i < steps; i++) {
      sum += trafficFactorAt(kind, (i * 86_400) / steps);
    }
    expect(sum / steps).toBeCloseTo(1, 6);
  }
});

test("a working day is busy at the rush hours and quiet at night", () => {
  const at = (h: number) => trafficFactorAt("weekday", h * 3600);
  expect(at(7.5)).toBeGreaterThan(1.5);
  expect(at(16.5)).toBeGreaterThan(1.5);
  expect(at(3.5)).toBeLessThan(0.15);
  expect(at(10.5)).toBeLessThan(at(7.5));
  // a Sunday morning is quieter than a working one
  expect(trafficFactorAt("sunday", 7.5 * 3600)).toBeLessThan(at(7.5) / 3);
});

test("the curve runs on across midnight without a jump", () => {
  const before = trafficFactorAt("weekday", 86_400 - 1);
  const after = trafficFactorAt("weekday", 0);
  expect(Math.abs(before - after)).toBeLessThan(0.01);
});

test("an instant reads its own day kind", () => {
  // Wednesday and Sunday, 8:00 local
  const wed = new Date(2026, 8, 30, 8, 0);
  const sun = new Date(2026, 9, 4, 8, 0);
  expect(trafficFactor(wed)).toBeGreaterThan(trafficFactor(sun));
});

test("the light slows as the street fills", () => {
  expect(trafficSpeed(0.2)).toBe(trafficSpeed(1));
  expect(trafficSpeed(1.8)).toBeLessThan(trafficSpeed(1) * 0.6);
});
