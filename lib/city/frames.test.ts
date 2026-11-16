/**
 * The frames' conversions (round trips, the axes' senses) and, as
 * `@ts-expect-error` lines, what the brands refuse: a scene coordinate
 * where a projected one is asked, and a plain number posing as either.
 */
import { expect, test } from "bun:test";
import { epsgToData, epsgToWorld, worldToEpsg } from "./frames";
import type { EpsgPair, EpsgX, EpsgY, SceneX, SceneZ } from "./frames";

const offset = { cx: 413_000, cy: 5_657_000 };

/** A projected ground read, as `GroundContext.heightAt` would be typed. */
const heightAt = (e: EpsgX, n: EpsgY): number => e - n;

test("worldToEpsg maps the world origin to the recenter point", () => {
  const at: { x: number; y: number } = worldToEpsg(0, 0, offset);
  expect(at).toEqual({ x: 413_000, y: 5_657_000 });
});

test("worldToEpsg: +x is east, -z is north", () => {
  const at: { x: number; y: number } = worldToEpsg(100, -200, offset);
  expect(at).toEqual({ x: 413_100, y: 5_657_200 });
});

test("epsgToWorld is the inverse of worldToEpsg", () => {
  const world = epsgToWorld(412_500, 5_657_700, offset);
  const roundTrip = worldToEpsg(world.x, world.z, offset);
  expect(roundTrip.x).toBeCloseTo(412_500);
  expect(roundTrip.y).toBeCloseTo(5_657_700);
});

test("the data frame is the scene's (x, −z), bit for bit", () => {
  for (const [e, n] of [
    [412_500.25, 5_657_700.125],
    [413_000, 5_657_000],
    [414_321.7, 5_655_012.3],
  ]) {
    const w = epsgToWorld(e, n, offset);
    const d = epsgToData(e, n, offset);
    const scene: number[] = [w.x, w.z];
    const data: number[] = [d.x, d.y];
    expect(data).toEqual([scene[0], -scene[1]]);
  }
});

test("a brand costs nothing: the values are the plain numbers", () => {
  const { x, z } = epsgToWorld(413_010, 5_656_980, offset);
  const at: number[] = [x, z];
  expect(at).toEqual([10, 20]);
  expect(typeof x).toBe("number");
});

test("the brands keep the frames apart (checked by the compiler)", () => {
  const { x: e, y: n } = worldToEpsg(5, 7, offset);
  const { x, z } = epsgToWorld(e, n, offset);
  // what a conversion returns is still a number for everything else
  const plain: number = x + z;
  expect(heightAt(e, n)).toBe(e - n);
  expect(plain).toBe(12);
  const refused = () => {
    // @ts-expect-error a scene (x, z) is not a projected (E, N)
    heightAt(x, z);
    // @ts-expect-error northing and easting swapped
    heightAt(n, e);
    // @ts-expect-error a plain number is in no frame
    heightAt(5, 7);
    // @ts-expect-error destructuring keeps the brand: z is not an easting
    const wrong: EpsgX = z;
    // @ts-expect-error a projected pair is not a scene point
    const pair: EpsgPair = [x, z];
    const scene: [SceneX, SceneZ] = [x, z];
    return [wrong, pair, scene];
  };
  expect(typeof refused).toBe("function");
});
