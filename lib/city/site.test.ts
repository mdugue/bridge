import { expect, test } from "bun:test";
import { SITES } from "../../sites";
import { directionOf } from "./pose";
import { overlook, spawnViewpoint, tileExtentOf } from "./site";

const DEG = Math.PI / 180;

test("overlook puts the target under the crosshair", () => {
  const target = { x: 1000, y: 2000 };
  const view = overlook(target, {
    id: "t",
    label: "T",
    description: "",
    altitude: 100,
    headingDeg: 135,
    pitchDeg: -45,
  });
  expect(view.mode).toBe("fly");
  expect(view.aboveGround).toBe(100);
  // Follow the view ray from the camera down to the ground (EPSG: x east,
  // y north; the world frame's −Z is north, so north = −d.z).
  const d = directionOf(view.headingDeg * DEG, view.pitchDeg * DEG);
  const t = view.aboveGround / -d.y;
  expect(view.epsg.x + d.x * t).toBeCloseTo(target.x, -0.5);
  expect(view.epsg.y - d.z * t).toBeCloseTo(target.y, -0.5);
});

test("overlook refuses a vantage that does not look down", () => {
  expect(() =>
    overlook(
      { x: 0, y: 0 },
      {
        id: "flat",
        label: "",
        description: "",
        altitude: 50,
        headingDeg: 0,
        pitchDeg: 0,
      }
    )
  ).toThrow();
});

for (const site of Object.values(SITES)) {
  const inside = (
    [x0, y0, x1, y1]: [number, number, number, number],
    p: { x: number; y: number }
  ) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;

  test(`${site.id}: every viewpoint stands on one of its tiles`, () => {
    const extents = site.tiles.map((cell) => tileExtentOf(site, cell));
    for (const view of site.viewpoints) {
      expect({
        id: view.id,
        onATile: extents.some((e) => inside(e, view.epsg)),
      }).toEqual({ id: view.id, onATile: true });
    }
  });

  test(`${site.id}: viewpoint ids are unique`, () => {
    const ids = site.viewpoints.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test(`${site.id}: the spawn is a viewpoint on the first tile`, () => {
    const spawn = spawnViewpoint(site);
    expect(inside(tileExtentOf(site, site.tiles[0]), spawn.epsg)).toBe(true);
  });
}
