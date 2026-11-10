import { expect, jest, test } from "bun:test";
import { BoxGeometry, Mesh, MeshBasicNodeMaterial } from "three/webgpu";
import { createLookState } from "@/lib/city/look-state";
import { climateDay, dayOfYear } from "@/lib/city/tree-season";
import { SEASON_THROTTLE_MS } from "./crown-season";
import type { SceneClock } from "./feature-seam";
import {
  clockMinutes,
  createSceneEnvironment,
  drawnAtNight,
  fountainsOn,
  sceneNight,
  withNightMaterialsShown,
} from "./scene-environment";
import type { SunState } from "./sun-rig";

// Hamburg's spring comes three days later than Dresden's: the season the
// trees take is the shifted day, read and heard alike.
const HAMBURG = { spring: 3, autumn: 5 };
const JUL_10 = new Date(2026, 6, 10, 12);
const APR_20 = new Date(2026, 3, 20, 12);
const OCT_20 = new Date(2026, 9, 20, 12);

const environment = () =>
  createSceneEnvironment({
    initialDate: JUL_10,
    climate: HAMBURG,
    look: createLookState(),
    castersChanged: () => {},
  });

const sunAt = (nightFactor: number) => ({ nightFactor }) as SunState;

test("the night is one node, held to [0, 1]", () => {
  const env = environment();
  try {
    env.light(sunAt(0.4));
    expect(sceneNight.value).toBeCloseTo(0.4);
    env.light(sunAt(1.5));
    expect(sceneNight.value).toBe(1);
    env.light(sunAt(-0.2));
    expect(sceneNight.value).toBe(0);
  } finally {
    env.dispose();
  }
});

test("the season is the city's climate day, read at once and heard throttled", () => {
  jest.useFakeTimers();
  const env = environment();
  try {
    const heard: number[] = [];
    env.season.subscribe((day) => {
      heard.push(day);
    });
    const shifted = (d: Date) => climateDay(Math.floor(dayOfYear(d)), HAMBURG);
    expect(env.season.get()).toBe(shifted(JUL_10));
    env.date(APR_20);
    // the shifted day, not the calendar's
    expect(shifted(APR_20)).not.toBe(Math.floor(dayOfYear(APR_20)));
    expect(heard).toEqual([shifted(APR_20)]);
    env.date(OCT_20);
    // read at once, heard once the throttle has passed
    expect(env.season.get()).toBe(shifted(OCT_20));
    expect(heard).toEqual([shifted(APR_20)]);
    jest.advanceTimersByTime(SEASON_THROTTLE_MS);
    expect(heard).toEqual([shifted(APR_20), shifted(OCT_20)]);
  } finally {
    env.dispose();
    jest.useRealTimers();
  }
});

test("a disposed environment lets a pending season go", () => {
  jest.useFakeTimers();
  const env = environment();
  try {
    const heard: number[] = [];
    env.season.subscribe((day) => {
      heard.push(day);
    });
    env.date(APR_20);
    env.date(OCT_20);
    env.dispose();
    jest.advanceTimersByTime(SEASON_THROTTLE_MS * 2);
    expect(heard).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

test("the clock is heard on every date, the same one twice too", () => {
  const env = environment();
  try {
    const heard: SceneClock[] = [];
    env.clock.subscribe((c) => {
      heard.push(c);
    });
    env.date(OCT_20);
    env.date(OCT_20);
    expect(heard.map((c) => c.date)).toEqual([OCT_20, OCT_20]);
    expect(env.clock.get().date).toBe(OCT_20);
  } finally {
    env.dispose();
  }
});

test("the clocks' hands move on the minute only, a dial's twelve hours", () => {
  const env = environment();
  try {
    env.date(new Date(2026, 5, 15, 14, 30, 5));
    const at = clockMinutes.value;
    env.date(new Date(2026, 5, 15, 14, 30, 50));
    expect(clockMinutes.value).toBe(at);
    env.date(new Date(2026, 5, 15, 14, 31, 0));
    expect(clockMinutes.value).toBe(at + 1);
    // 2:31 and 14:31 read the same on a dial
    env.date(new Date(2026, 5, 15, 2, 31, 0));
    expect(clockMinutes.value).toBe(at + 1);
  } finally {
    env.dispose();
  }
});

test("the fountains run from mid-April and are drained from November", () => {
  const env = environment();
  try {
    env.date(new Date(2026, 6, 15, 12));
    expect(fountainsOn.value).toBe(1);
    env.date(new Date(2026, 0, 15, 12));
    expect(fountainsOn.value).toBe(0);
  } finally {
    env.dispose();
  }
});

test("a compile by day sees the night-only materials shown, and no other hidden one", () => {
  sceneNight.value = 0;
  const halo = drawnAtNight(new MeshBasicNodeMaterial());
  const off = new MeshBasicNodeMaterial();
  off.visible = false;
  const mesh = new Mesh(new BoxGeometry(), [halo, off]);
  expect(
    withNightMaterialsShown(mesh, () => [halo.visible, off.visible])
  ).toEqual([true, false]);
  expect(halo.visible).toBe(false);
  // let go of on dispose: no longer shown for a compile
  halo.dispose();
  expect(withNightMaterialsShown(mesh, () => halo.visible)).toBe(false);
});
