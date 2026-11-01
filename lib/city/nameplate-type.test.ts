import { expect, test } from "bun:test";
import { RENDER_STYLES } from "./render-style";
import {
  NAMEPLATE_CAPS,
  NAMEPLATE_TYPES,
  atNight,
  linesSize,
  nightDim,
} from "./nameplate-type";

test("every style sets the plate, only Schwarzplan on the ground", () => {
  for (const { id: style } of RENDER_STYLES) {
    const type = NAMEPLATE_TYPES[style];
    expect(type).toBeDefined();
    expect(type.onGround).toBe(style === "figure");
  }
  expect(NAMEPLATE_TYPES.comic.box).toBeDefined();
  expect(NAMEPLATE_TYPES.comic.leader).toBe("tail");
});

test("light on dark by night where the day sets dark on light", () => {
  const lum = ([r, g, b]: readonly number[]) =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (const style of ["pastel", "paper", "line"] as const) {
    const type = NAMEPLATE_TYPES[style];
    expect(lum(atNight(type.ink, 0))).toBeLessThan(lum(atNight(type.halo, 0)));
    expect(lum(atNight(type.ink, 1))).toBeGreaterThan(
      lum(atNight(type.halo, 1))
    );
  }
});

test("the night blends and dims within bounds", () => {
  const c = { day: [0, 0, 0] as const, night: [1, 1, 1] as const };
  expect(atNight(c, 0.5)).toEqual([0.5, 0.5, 0.5]);
  expect(atNight(c, 2)).toEqual([1, 1, 1]);
  expect(nightDim(0)).toBe(1);
  expect(nightDim(1)).toBeCloseTo(0.82);
});

test("the ranks step down in size, a phone smaller", () => {
  const { landmark, named, address } = NAMEPLATE_CAPS;
  expect(landmark.desktop.max).toBeGreaterThan(named.desktop.max);
  expect(named.desktop.max).toBeGreaterThan(address.desktop.max);
  for (const rank of [landmark, named, address]) {
    expect(rank.phone.max).toBeLessThanOrEqual(rank.desktop.max);
    expect(rank.phone.min).toBeLessThanOrEqual(rank.phone.max);
  }
  const t = NAMEPLATE_TYPES.pastel;
  expect(linesSize(t, "named")).toBeGreaterThan(linesSize(t, "landmark"));
});
