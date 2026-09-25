import { expect, test } from "bun:test";
import { KERB_HEIGHT, KERB_WIDTH, kerbGeometry } from "./kerbs";

const offset = { cx: 0, cy: 0 };
const flat = () => 100;
// Eastward, so the road (on the left) is to the north.
const east: [number, number][] = [
  [0, 0],
  [10, 0],
];

test("a kerb is a face, a top and a back per densified span", () => {
  // 10 m at 2.5 m spacing → 5 columns → 4 spans × 3 quads × 6 vertices.
  expect(kerbGeometry([east], flat, offset)?.positions.length).toBe(
    4 * 3 * 6 * 3
  );
  expect(kerbGeometry([], flat, offset)).toBeNull();
  expect(kerbGeometry([east], () => null, offset)).toBeNull();
});

test("the stone stands its height above the road, its face toward it", () => {
  const g = kerbGeometry([east], flat, offset);
  const pos = g?.positions ?? [];
  const ys = pos.filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys)).toBeCloseTo(100 + KERB_HEIGHT, 6);
  // The face normal points north: world −z (EPSG north is world −Z).
  expect(g?.normals.slice(0, 3)).toEqual([0, 0, -1]);
  // The back lies KERB_WIDTH south of the line: world +z.
  const zs = pos.filter((_, i) => i % 3 === 2);
  expect(Math.max(...zs)).toBeCloseTo(KERB_WIDTH, 6);
});

test("on a road lower than the pavement the top is level with the pavement", () => {
  // Pavement (south, y < 0) 0.3 m above the road: the stone tops out there.
  const step = (_x: number, y: number) => (y < -0.1 ? 100.3 : 100);
  const ys = (kerbGeometry([east], step, offset)?.positions ?? []).filter(
    (_, i) => i % 3 === 1
  );
  expect(Math.max(...ys)).toBeCloseTo(100.32, 6);
});

test("every triangle winds counter-clockwise about its normal", () => {
  const g = kerbGeometry([east], flat, offset);
  const p = g?.positions ?? [];
  const n = g?.normals ?? [];
  for (let t = 0; t < p.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.slice(t, t + 9);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const dot = cross[0] * n[t] + cross[1] * n[t + 1] + cross[2] * n[t + 2];
    expect(dot).toBeGreaterThan(0);
  }
});
