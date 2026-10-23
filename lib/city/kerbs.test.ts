import { expect, test } from "bun:test";
import {
  KERB_HEIGHT,
  KERB_WIDTH,
  kerbGeometry,
  kerbHeightAt,
  RAMP_M,
} from "./kerbs";

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
  expect(Math.max(...ys)).toBeCloseTo(100.31, 6);
});

test("the top falls to the pavement at the back: no second step there", () => {
  // The smoothed DGM: the pavement (south) only 4 cm above the road.
  const ramp = (_x: number, y: number) => (y < -0.1 ? 100.04 : 100);
  const g = kerbGeometry([east], ramp, offset);
  const pos = g?.positions ?? [];
  const backTops: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    // world +z is south: the back edge lies KERB_WIDTH south of the line
    if (Math.abs(pos[i + 2] - KERB_WIDTH) < 1e-6 && pos[i + 1] > 100) {
      backTops.push(pos[i + 1]);
    }
  }
  expect(backTops.length).toBeGreaterThan(0);
  for (const y of backTops) {
    expect(y).toBeCloseTo(100.05, 6);
  }
  // the face still stands the kerb's height over the road
  const ys = pos.filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys)).toBeCloseTo(100 + KERB_HEIGHT, 6);
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

test("a lowered stretch stands its drop over the road and ramps back", () => {
  expect(kerbHeightAt(5, [])).toBe(KERB_HEIGHT);
  const low = [[4, 6, 0.03]] as const;
  expect(kerbHeightAt(5, low)).toBeCloseTo(0.03, 9);
  expect(kerbHeightAt(4, low)).toBeCloseTo(0.03, 9);
  // halfway up the ramp, then full beyond it
  expect(kerbHeightAt(6 + RAMP_M / 2, low)).toBeCloseTo(
    (0.03 + KERB_HEIGHT) / 2,
    9
  );
  expect(kerbHeightAt(6 + RAMP_M, low)).toBeCloseTo(KERB_HEIGHT, 9);
  expect(kerbHeightAt(1, low)).toBe(KERB_HEIGHT);
  // overlapping drops: the lower holds
  expect(kerbHeightAt(5, [...low, [4.5, 5.5, 0]])).toBe(0);
});

test("a kerb line's drops lower its face top there and nowhere else", () => {
  const g = kerbGeometry([{ coords: east, low: [[4, 6, 0.03]] }], flat, offset);
  const pos = g?.positions ?? [];
  expect(pos.length).toBeGreaterThan(0);
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
    if (Math.abs(z) < 1e-6 && y > 100) {
      // a face-top vertex (on the line): its stone's height there
      const want =
        x >= 4 - 1e-6 && x <= 6 + 1e-6
          ? 0.03
          : x <= 4 - RAMP_M || x >= 6 + RAMP_M
            ? KERB_HEIGHT
            : null;
      if (want !== null) {
        expect(y).toBeCloseTo(100 + want, 6);
      }
    }
  }
  // the stretch's ends are vertices: the profile bends there
  const xs = new Set(
    pos.filter((_, i) => i % 3 === 0).map((x) => x.toFixed(3))
  );
  for (const x of [3.5, 4, 6, 6.5]) {
    expect(xs.has(x.toFixed(3))).toBe(true);
  }
  // a flush stretch on a pavement above the road still meets the pavement
  const step = (_x: number, y: number) => (y < -0.1 ? 100.05 : 100);
  const flush = kerbGeometry(
    [{ coords: east, low: [[0, 10, 0]] }],
    step,
    offset
  );
  const ys = (flush?.positions ?? []).filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys)).toBeCloseTo(100.06, 6);
  expect(flush?.joins.length).toBeGreaterThan(0);
});
