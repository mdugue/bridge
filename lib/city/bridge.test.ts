import { expect, test } from "bun:test";
import {
  archFits,
  archSpringing,
  BRIDGE_STEP,
  fitParabola,
  PIER_SPACING,
  pierStations,
  placeRibs,
  ribPeaks,
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
