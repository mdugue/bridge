import { expect, test } from "bun:test";
import { Matrix4, Vector3 } from "three/webgpu";
import type { GroundContext } from "@/lib/city/ground-clamp";
import type { TramTimetable } from "@/lib/city/tram-timetable";
import type { Instances } from "./instancing";
import { createTramCars } from "./tram-cars";

const TT: TramTimetable = {
  routes: ["11"],
  patterns: [
    {
      route: 0,
      coords: [
        [0, 0],
        [1000, 0],
      ],
      at: [0, 1000],
      bridge: [],
    },
  ],
  profiles: [{ pattern: 0, t: [0, 0, 120, 140] }],
  days: { weekday: { date: "2026-10-01", trips: [[0, 8 * 3600]] } },
};

const ctx: GroundContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: (x) => (x < 900 ? 110 : null),
};

const sets = (cars: ReturnType<typeof createTramCars>) =>
  cars.group.children as Instances[];

test("a running tram is four sections on its rails; none before its start", () => {
  const cars = createTramCars(TT, [], ctx);
  const before = cars.update(new Date(2026, 9, 1, 7, 59));
  expect(before).toEqual({ date: "2026-10-01", kind: "weekday", running: 0 });
  expect(sets(cars)[0].drawCount).toBe(0);
  const status = cars.update(new Date(2026, 9, 1, 8, 1));
  expect(status.running).toBe(1);
  const [body, band, roof] = sets(cars);
  expect(body.drawCount).toBe(4);
  // the three parts share the body's matrices: one buffer, one upload
  expect(band.instanceMatrix).toBe(body.instanceMatrix);
  expect(roof.drawCount).toBe(4);
  expect(body.castShadow).toBe(false);
  const m = new Matrix4().fromArray(body.instanceMatrix.array, 0);
  const at = new Vector3().setFromMatrixPosition(m);
  // halfway at 60 s of 120 (eased): 500 m along, on the street's rail top
  expect(at.x).toBeGreaterThan(480);
  expect(at.x).toBeLessThan(500);
  expect(at.y).toBeCloseTo(110.02, 4);
  expect(at.z).toBeCloseTo(0, 6);
  cars.dispose();
});

test("off the loaded ground a section is not drawn", () => {
  const cars = createTramCars(TT, [], ctx);
  // 08:02 — the car is past 900 m, over ground not streamed in
  cars.update(new Date(2026, 9, 1, 8, 1, 55));
  expect(sets(cars)[0].drawCount).toBeLessThan(4);
  cars.dispose();
});

test("a Sunday without a timetable runs nothing", () => {
  const cars = createTramCars(TT, [], ctx);
  expect(cars.update(new Date(2026, 9, 4, 8, 1))).toEqual({
    date: null,
    kind: "sunday",
    running: 0,
  });
  cars.dispose();
});
