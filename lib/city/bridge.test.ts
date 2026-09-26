import { expect, test } from "bun:test";
import {
  archFits,
  archSpringing,
  axisFrame,
  BRIDGE_STEP,
  intradosAt,
  masonrySpans,
  fitParabola,
  PIER_SPACING,
  pierStations,
  placeRibs,
  ribPeaks,
  ribProfile,
  ribRuns,
  smoothRise,
} from "./bridge";

test("ribRuns finds each stretch a rib stands on", () => {
  expect(ribRuns([0, 1, 2, 0, 0, 3, 0])).toEqual([
    [1, 2],
    [5, 5],
  ]);
  expect(ribRuns([4, 4])).toEqual([[0, 1]]);
  expect(ribRuns([0, 0])).toEqual([]);
});

test("ribPeaks: a truss sagging between two pylons has two", () => {
  // the Blaues Wunder's shape: rise to a pylon, sag, rise, fall
  const tent = (i: number, at: number) =>
    Math.max(0, 24 - Math.abs(i - at) * 0.6);
  const rise = Array.from({ length: 160 }, (_, i) =>
    Math.max(tent(i, 35), tent(i, 105), 2)
  );
  expect(ribPeaks(rise)).toEqual([35, 105]);
  // low bumps are no pylons; two maxima closer than 30 m are one
  expect(ribPeaks([0, 5, 6, 5, 0])).toEqual([]);
  expect(ribPeaks([0, 11, 12, 11, 12.5, 11, 0])).toEqual([4]);
});

test("fitParabola recovers a parabola", () => {
  const pts = Array.from({ length: 20 }, (_, i) => {
    const s = 100 + i * 5;
    return { s, y: -0.002 * (s - 150) ** 2 + 130 };
  });
  const fit = fitParabola(pts);
  expect(fit).not.toBeNull();
  expect(fit?.a).toBeCloseTo(-0.002, 6);
  expect(fit?.rms).toBeLessThan(1e-6);
  expect(fitParabola(pts.slice(0, 2))).toBeNull();
});

test("an arch rib is carried down to the ground", () => {
  // a 148 m arch springing at 104 m, crown 16 m up, deck at 116 m
  const crownS = 300;
  const arch = (s: number) => 104 + 16 * (1 - ((s - crownS) / 74) ** 2);
  const line = Array.from({ length: 301 }, () => 116);
  const rise = line.map((deck, i) => Math.max(0, arch(i * BRIDGE_STEP) - deck));
  const [fit] = archFits([{ offset: 0, rise }], line);
  expect(fit).not.toBeNull();
  const span = fit ? archSpringing(fit, 600, () => 104) : null;
  expect(span?.from).toBeCloseTo(crownS - 74, -1);
  expect(span?.to).toBeCloseTo(crownS + 74, -1);
  // a rib that opens upwards is no arch
  const bowl = line.map((_, i) =>
    Math.abs(i - 150) < 30 ? 2 + (i - 150) ** 2 / 100 : 0
  );
  expect(archFits([{ offset: 0, rise: bowl }], line)).toEqual([null]);
});

test("pierStations keep the fairway clear", () => {
  const plain = pierStations(260);
  expect(plain.length).toBe(9);
  const opened = pierStations(260, { fairway: 0.5, span: 80 });
  expect(opened.some((s) => Math.abs(s - 130) < 40)).toBe(false);
  expect(opened).toContain(90);
  expect(opened).toContain(170);
  // piers stay apart
  for (let i = 1; i < opened.length; i++) {
    expect(opened[i] - opened[i - 1]).toBeGreaterThan(PIER_SPACING / 2);
  }
  expect(pierStations(20)).toEqual([]);
});

test("the ribs of one arch share the tightest rib's curve", () => {
  const line = Array.from({ length: 201 }, () => 120);
  const arch = (s: number) => 132 - 0.004 * (s - 200) ** 2;
  const clean = line.map((deck, i) =>
    Math.max(0, arch(i * BRIDGE_STEP) - deck)
  );
  // the other side: the same arch 1 m lower, measured with holes and noise
  const patchy = clean.map((r, i) =>
    r > 1 && i % 7 !== 0 ? Math.max(0.1, r - 1 + ((i * 37) % 5) - 2) : 0
  );
  // a catenary along the deck: flat, no arch
  const wire = line.map(() => 6);
  const [a, b, c] = archFits(
    [
      { offset: 8, rise: clean },
      { offset: -8, rise: patchy },
      { offset: 0, rise: wire },
    ],
    line
  );
  expect(a?.a).toBeCloseTo(-0.004, 5);
  expect(b?.a).toBe(a?.a);
  expect(b?.c).toBeCloseTo((a?.c ?? 0) - 1, 0);
  expect(c).toBeNull();
  expect(archFits([{ offset: 0, rise: wire }], line)).toEqual([null]);
});

test("placeRibs puts the two sides on the deck edges and a lone pylon central", () => {
  const rise = [0, 5, 0];
  const edges = { left: 5.5, right: -5.5 };
  const [a, b] = placeRibs(
    [
      { offset: -5.5, rise },
      { offset: 3, rise },
    ],
    edges
  );
  expect(a.offset).toBeCloseTo(-5.9);
  expect(b.offset).toBeCloseTo(5.9);
  expect(placeRibs([{ offset: 2, rise }], edges)[0].offset).toBe(0);
  expect(placeRibs([{ offset: -7, rise }], edges)[0].offset).toBeCloseTo(-5.9);
  // both measured on one side: the outer keeps it, the inner goes across
  const same = placeRibs(
    [
      { offset: 1.5, rise },
      { offset: 6, rise },
    ],
    edges
  );
  expect(same.map((r) => r.offset).sort((p, q) => p - q)).toEqual([-5.9, 5.9]);
});

test("smoothRise calms the top edge and leaves the gaps alone", () => {
  expect(smoothRise([0, 10, 20, 10, 0], 3)).toEqual([0, 15, 40 / 3, 15, 0]);
});

test("axisFrame follows a bent centreline and projects onto it", () => {
  // 100 m east, then 100 m north
  const frame = axisFrame([
    [0, 0],
    [100, 0],
    [100, 100],
  ]);
  expect(frame?.length).toBe(200);
  expect(frame?.at(50, 6)).toEqual([50, 6]);
  expect(frame?.at(150, 6)).toEqual([94, 50]);
  const p = frame?.project(106, 50);
  expect(p?.s).toBeCloseTo(150, 6);
  expect(p?.offset).toBeCloseTo(-6, 6);
  // beyond the first abutment the station runs on, negative
  expect(frame?.project(-5, 2).s).toBeCloseTo(-5, 6);
  expect(axisFrame([[1, 1]])).toBeNull();
});

test("ribProfile: straight chords to the towers, a sag between, nothing hanging", () => {
  // two towers 24 m up, a wavy side arm that stops 9 m above the deck,
  // the middle lost to the raster
  const rise = Array.from({ length: 160 }, (_, i) => {
    if (i < 10 || i > 150 || (i > 60 && i < 80)) {
      return 0;
    }
    const tower = Math.max(
      0,
      24 - Math.min(Math.abs(i - 35), Math.abs(i - 105)) * 0.5
    );
    return Math.max(9, tower) + (i % 3) * 0.8;
  });
  const out = ribProfile(rise);
  const towers = ribPeaks(rise);
  expect(towers).toHaveLength(2);
  for (const i of towers) {
    expect(out[i]).toBe(rise[i]);
  }
  // the ends come down to the deck
  expect(out[10]).toBeLessThan(0.5);
  expect(out[150]).toBeLessThan(0.5);
  expect(out[9]).toBe(0);
  // one run from end to end, the gap bridged by the sag down to the deck
  expect(ribRuns(out)).toEqual([[10, 150]]);
  expect(Math.min(...out.slice(towers[0], towers[1]))).toBeLessThan(1);
  // no waves: the side arm rises steadily to its tower
  for (let i = 11; i <= towers[0]; i++) {
    expect(out[i]).toBeGreaterThan(out[i - 1]);
  }
  // no towers: a level girder
  expect(new Set(ribProfile([0, 6, 7, 6.5, 6, 0]).slice(1, 5)).size).toBe(1);
});

test("masonrySpans arch where the deck clears the ground, not at the banks", () => {
  // 260 m: banks at 118 m for 40 m each end, the river at 100 m between
  const ground = (s: number) => (s < 40 || s > 220 ? 118 : 100);
  const spans = masonrySpans(260, ground, () => 118);
  expect(spans.length).toBeGreaterThan(3);
  for (const sp of spans) {
    expect(sp.crown).toBe(117.5);
    expect(sp.spring).toBe(100.5);
    expect(sp.from).toBeGreaterThanOrEqual(26);
  }
  const [first] = spans;
  const mid = (first.from + first.to) / 2;
  expect(intradosAt(first, mid)).toBeCloseTo(117.5, 6);
  expect(intradosAt(first, first.from)).toBeCloseTo(100.5, 6);
  expect(intradosAt(first, first.to + 1)).toBeNull();
});
