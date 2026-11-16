import { expect, test } from "bun:test";
import {
  expandRail,
  packRails,
  RAIL_MAX_SEGMENT_M,
  RAIL_RECORD_BYTES,
  RAIL_STEP_M,
  RAIL_STEP_Y_M,
  RAIL_TOLERANCE,
  railFile,
  railSegmentAt,
  railSegmentCount,
  runBearings,
  simplifyRun,
} from "./rail-table";
import type { RailRun } from "./rail-table";

/** A curving, undulating street track, a sample every 2 m. */
const run = (n = 40): RailRun => ({
  gauge: 1.435,
  lateral: 0,
  look: "tram-street",
  web: 0.04,
  pts: Array.from({ length: n }, (_, i) => ({
    x: 730 + i * 2,
    y: 111.2 + Math.sin(i / 6) * 0.3,
    z: -415 + Math.sin(i / 9) * 5,
  })),
});

test("a record is twenty bytes; a run of n samples is n − 1 of them", () => {
  expect(RAIL_RECORD_BYTES % 4).toBe(0);
  const report = { clamped: 0, segments: 0 };
  const chunks = packRails([run()], report);
  expect(report).toEqual({ clamped: 0, segments: 39 });
  expect(chunks.reduce((n, c) => n + railSegmentCount(c), 0)).toBe(39);
  expect(railFile(chunks).length).toBe(8 + chunks.length * 28 + 39 * 20);
});

test("a segment's ends come back within half a step", () => {
  const r = run();
  const [chunk] = packRails([r]);
  const s = railSegmentAt(chunk, 0);
  expect(Math.abs(s.a.x - r.pts[0].x)).toBeLessThanOrEqual(RAIL_STEP_M / 2);
  expect(Math.abs(s.a.z - r.pts[0].z)).toBeLessThanOrEqual(RAIL_STEP_M / 2);
  expect(Math.abs(s.a.y - r.pts[0].y)).toBeLessThanOrEqual(RAIL_STEP_Y_M / 2);
  expect(Math.abs(s.b.y - r.pts[1].y)).toBeLessThanOrEqual(RAIL_STEP_Y_M / 2);
});

test("the expanded rail is the builder's ribbon: offset across the bearing at each end", () => {
  const r = { ...run(), lateral: 4.5 };
  const bearings = runBearings(r.pts);
  const [chunk] = packRails([r]);
  const s = railSegmentAt(chunk, 3);
  const across = r.gauge / 2 + 0.075;
  for (const [t, i] of [
    [0, 3],
    [1, 4],
  ] as const) {
    const p = expandRail(s, t, across);
    // mesh-kit.ts `addRibbon`: p + (−tan.y, tan.x) · (lateral + side)
    const nx = -Math.sin(bearings[i]);
    const nz = Math.cos(bearings[i]);
    expect(p.x).toBeCloseTo(r.pts[i].x + nx * (4.5 + across), 1);
    expect(p.z).toBeCloseTo(r.pts[i].z + nz * (4.5 + across), 1);
    expect(Math.abs(p.y - r.pts[i].y)).toBeLessThanOrEqual(RAIL_STEP_Y_M / 2);
  }
  expect(expandRail(s, 0, 0, 0.04).y).toBeCloseTo(s.a.y - 0.04, 9);
});

test("a straight, even street keeps its ends; a kept point keeps its bearing", () => {
  const straight: RailRun = {
    ...run(),
    pts: Array.from({ length: 30 }, (_, i) => ({
      x: i * 2,
      y: 100 + i * 0.01,
      z: 7,
    })),
  };
  expect(simplifyRun(straight).pts.length).toBe(2);
  const r = run();
  const kept = simplifyRun(r);
  expect(kept.pts.length).toBeLessThan(r.pts.length);
  expect(kept.pts.length).toBeGreaterThan(2);
  const bearings = runBearings(r.pts);
  for (const [k, p] of kept.pts.entries()) {
    expect(kept.bearings?.[k]).toBe(bearings[r.pts.indexOf(p)]);
  }
});

test("no dropped sample lies further from its segment than the tolerance", () => {
  const r = run(80);
  const kept = simplifyRun(r);
  let k = 0;
  for (const p of r.pts) {
    while (k < kept.pts.length - 2 && kept.pts[k + 1].x < p.x) {
      k += 1;
    }
    const a = kept.pts[k];
    const b = kept.pts[k + 1];
    const t = (p.x - a.x) / (b.x - a.x);
    expect(Math.abs(a.y + (b.y - a.y) * t - p.y)).toBeLessThanOrEqual(
      RAIL_TOLERANCE.height + 1e-9
    );
    expect(Math.abs(a.z + (b.z - a.z) * t - p.z)).toBeLessThanOrEqual(
      RAIL_TOLERANCE.across + 1e-3
    );
  }
});

test("a simplified segment is no longer than a record reaches, and none is clamped", () => {
  const long: RailRun = {
    ...run(),
    pts: Array.from({ length: 600 }, (_, i) => ({ x: i * 2, y: 100, z: 7 })),
  };
  const kept = simplifyRun(long);
  for (let i = 1; i < kept.pts.length; i += 1) {
    expect(kept.pts[i].x - kept.pts[i - 1].x).toBeLessThanOrEqual(
      RAIL_MAX_SEGMENT_M
    );
  }
  const report = { clamped: 0, segments: 0 };
  packRails([kept], report);
  expect(report.clamped).toBe(0);
});
