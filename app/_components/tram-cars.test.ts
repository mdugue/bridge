import { expect, test } from "bun:test";
import { Color, Matrix4, Vector3 } from "three/webgpu";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { TRAM_LIVERIES, type TramTimetable } from "@/lib/city/tram-timetable";
import type { Instances } from "./instancing";
import { carSections, createTramCars } from "./tram-cars";

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

test("a running tram trails light along its track, fading behind it", () => {
  const cars = createTramCars(TT, [], ctx);
  cars.update(new Date(2026, 9, 1, 8, 1));
  const trail = cars.group.getObjectByName("tram-trails") as unknown as {
    geometry: {
      drawRange: { count: number };
      getAttribute: (n: string) => { getX: (i: number) => number };
    };
  };
  expect(trail.geometry.drawRange.count).toBe(23 * 6);
  // its faces look up (the light lies on the track, seen from above)
  const g = cars.group.getObjectByName("tram-trails") as unknown as {
    geometry: import("three/webgpu").BufferGeometry;
  };
  const pos = g.geometry.getAttribute("position");
  const idx = g.geometry.getIndex();
  const v = (i: number) =>
    new Vector3().fromBufferAttribute(pos, idx?.getX(i) ?? 0);
  const n = v(1)
    .sub(v(0))
    .cross(v(2).sub(v(0)));
  expect(n.y).toBeGreaterThan(0);
  const fade = trail.geometry.getAttribute("trailFade");
  expect(fade.getX(0)).toBe(1);
  expect(fade.getX(2 * 23)).toBe(0);
  cars.dispose();
});

test("a car takes its operator's livery and a length its fleet runs", () => {
  const leipzig: TramTimetable = {
    ...TT,
    agencies: ["LVB"],
    routeAgency: [0],
  };
  const cars = createTramCars(leipzig, [], ctx);
  cars.update(new Date(2026, 9, 1, 8, 1));
  const byName = (name: string) =>
    sets(cars).find((s) => s.name === `tram-car-${name}`) as Instances;
  const body = byName("body");
  // LVB's cars are 37.6 or 45 m: five or six sections
  expect([5, 6]).toContain(body.drawCount);
  const rgb = (set: Instances) =>
    new Color().fromArray(set.instanceTints?.array ?? [], 0).getHex();
  expect(rgb(body)).toBe(TRAM_LIVERIES.lvb.body);
  expect(rgb(byName("top"))).toBe(TRAM_LIVERIES.lvb.top);
  expect(rgb(byName("skirt"))).toBe(TRAM_LIVERIES.lvb.skirt);
  // the window band and the roof are every car's alike
  expect(byName("band").instanceTints).toBeNull();
  // the sections are stretched to the car's length: front to back
  const at = (i: number) =>
    new Vector3().setFromMatrixPosition(
      new Matrix4().fromArray(body.instanceMatrix.array, i * 16)
    );
  const n = body.drawCount;
  const span = at(0).distanceTo(at(n - 1));
  const { stretch } = carSections(n === 5 ? 37.6 : 45);
  expect(span).toBeCloseTo((n - 1) * (7.2 * stretch + 0.3), 1);
  cars.dispose();
});

test("a car's sections: about 7.5 m each, stretched to the length", () => {
  expect(carSections(30).n).toBe(4);
  expect(carSections(45).n).toBe(6);
  const { n, stretch } = carSections(36);
  expect(n).toBe(5);
  expect(n * 7.2 * stretch + (n - 1) * 0.3).toBeCloseTo(36, 6);
});
