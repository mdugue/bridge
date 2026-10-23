import { expect, test } from "bun:test";
import {
  approachLanding,
  archFits,
  archSpringing,
  axisFrame,
  BRIDGE_STEP,
  beamSpan,
  beamSupports,
  deckCarrier,
  deckDepth,
  intradosAt,
  masonryArches,
  masonryBays,
  fitParabola,
  PIER_SPACING,
  parapetStyle,
  pierStations,
  VIADUCT_BAY_M,
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
  // no span over PIER_SPACING; a short deck spans its gap alone
  const piers = [0, ...pierStations(200), 200];
  for (let i = 1; i < piers.length; i++) {
    expect(piers[i] - piers[i - 1]).toBeLessThanOrEqual(PIER_SPACING);
  }
  expect(pierStations(38)).toEqual([]);
});

test("a deck is as deep as what carries it, the fairway only a cap", () => {
  expect(deckCarrier("beam")).toBe("beam");
  expect(deckCarrier("")).toBe("beam");
  expect(deckCarrier(null)).toBe("beam");
  expect(deckCarrier("arch;beam")).toBe("arch");
  expect(deckCarrier("humpback")).toBe("arch");
  expect(deckCarrier("suspension;cantilever")).toBe("frame");
  expect(deckCarrier("truss")).toBe("frame");
  expect(deckCarrier("cable-stayed")).toBe("frame");
  // a beam a twentieth of its span, within 0.8–2.5 m
  expect(deckDepth("beam", 26)).toBeCloseTo(1.3, 6);
  expect(deckDepth("beam", 13)).toBe(0.8);
  expect(deckDepth("beam", 120)).toBe(2.5);
  expect(deckDepth("arch", 60)).toBe(1);
  expect(deckDepth("frame", 120)).toBe(1.2);
  // the clearance under a fairway caps it, never deepens it (the 5 m clamp
  // the Meißen bridges hit)
  expect(deckDepth("beam", 60, 1.1)).toBe(1.1);
  expect(deckDepth("frame", 120, 5)).toBe(1.2);
});

test("a long rail deck over land stands on paired columns, over water on piers", () => {
  // the U3's viaduct: 688 m on columns every 10–15 m
  const viaduct = beamSupports(688, { kind: "rail" });
  expect(viaduct.every((p) => p.edge)).toBe(true);
  const at = [0, ...viaduct.map((p) => p.s), 688];
  for (let i = 1; i < at.length; i++) {
    expect(at[i] - at[i - 1]).toBeLessThanOrEqual(VIADUCT_BAY_M);
    expect(at[i] - at[i - 1]).toBeGreaterThan(12);
  }
  expect(deckDepth("beam", beamSpan(688, viaduct))).toBe(0.8);
  // a canal under it: piers on the axis, no span over PIER_SPACING
  const crossing = beamSupports(300, { kind: "rail", water: [[100, 160]] });
  const wet = crossing.filter((p) => p.s >= 100 && p.s <= 160);
  expect(wet.length).toBeGreaterThan(0);
  expect(wet.every((p) => !p.edge)).toBe(true);
  const all = [0, ...crossing.map((p) => p.s), 300];
  for (let i = 1; i < all.length; i++) {
    expect(all[i] - all[i - 1]).toBeLessThanOrEqual(PIER_SPACING);
  }
  // a fairway it crosses stays open between two piers on the axis
  const fairway = beamSupports(300, { kind: "rail", fairway: 0.5 });
  // (40 m without a known main span)
  expect(fairway.some((p) => p.s > 130 && p.s < 170)).toBe(false);
  expect(fairway.filter((p) => !p.edge).map((p) => p.s)).toEqual([130, 170]);
  expect(fairway.some((p) => p.edge)).toBe(true);
  // a road deck, a short rail deck and a truss keep their piers
  for (const supports of [
    beamSupports(300, { kind: "road" }),
    beamSupports(90, { kind: "rail" }),
    beamSupports(300, { kind: "rail", structure: "truss" }),
  ]) {
    expect(supports.length).toBeGreaterThan(0);
    expect(supports.every((p) => !p.edge)).toBe(true);
  }
  // a known main span sets the depth
  expect(beamSpan(300, beamSupports(300, { kind: "road" }), 80)).toBe(80);
  expect(beamSpan(30, [])).toBe(30);
});

test("a masonry bridge keeps its ashlar parapet, every other an open railing", () => {
  expect(parapetStyle("arch")).toBe("ashlar");
  expect(parapetStyle("humpback")).toBe("ashlar");
  expect(parapetStyle("stone")).toBe("ashlar");
  // a steel arch measured above the deck is no masonry
  expect(parapetStyle("arch", true)).toBe("railing");
  for (const s of ["beam", "truss", "suspension", "cable-stayed", "", null]) {
    expect(parapetStyle(s)).toBe("railing");
  }
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
  expect(a.offset).toBeCloseTo(-5.2);
  expect(b.offset).toBeCloseTo(5.2);
  expect(placeRibs([{ offset: 2, rise }], edges)[0].offset).toBe(0);
  expect(placeRibs([{ offset: -7, rise }], edges)[0].offset).toBeCloseTo(-5.2);
  // both measured on one side: the outer keeps it, the inner goes across
  const same = placeRibs(
    [
      { offset: 1.5, rise },
      { offset: 6, rise },
    ],
    edges
  );
  expect(same.map((r) => r.offset).sort((p, q) => p - q)).toEqual([-5.2, 5.2]);
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
  // one run from end to end, the gap bridged by the sag
  expect(ribRuns(out)).toEqual([[10, 150]]);
  // ...but not down onto the parapet: a chord, not a strip along the edge
  const sagLow = Math.min(...out.slice(towers[0], towers[1]));
  expect(sagLow).toBeCloseTo(2.6, 1);
  // no waves: the side arm rises steadily to its tower
  for (let i = 11; i <= towers[0]; i++) {
    expect(out[i]).toBeGreaterThan(out[i - 1]);
  }
  // no towers: a level girder
  expect(new Set(ribProfile([0, 6, 7, 6.5, 6, 0]).slice(1, 5)).size).toBe(1);
});

test("masonryArches: arches between real piers, not at the banks", () => {
  // 260 m: banks at 118 m for 40 m each end, the river at 100 m between
  const ground = (s: number) => (s < 40 || s > 220 ? 118 : 100);
  const { spans, piers } = masonryArches(260, ground, () => 118);
  // ten bays of 26 m, the four touching a bank too low for an arch
  expect(spans).toHaveLength(6);
  // piers a seventh of their bays thick
  const half = 26 / 7 / 2;
  // a segmental arch: a fifth of its clear span under the crown
  const spring = 117.8 - (26 - 2 * half) / 5;
  for (const sp of spans) {
    expect(sp.crown).toBeCloseTo(117.8, 6);
    expect(sp.spring).toBeCloseTo(spring, 6);
    expect(sp.from).toBeGreaterThanOrEqual(26);
  }
  // each pier stands between two arches, as thick as the gap they leave
  expect(piers).toHaveLength(7);
  for (const pier of piers) {
    expect(pier.top).toBeCloseTo(spring, 6);
    expect(pier.ground).toBe(100);
    expect(pier.half).toBeCloseTo(half, 6);
  }
  const [first, second] = spans;
  expect(second.from - first.to).toBeCloseTo(2 * half, 6);
  const mid = (first.from + first.to) / 2;
  expect(intradosAt(first, mid)).toBeCloseTo(117.8, 6);
  expect(intradosAt(first, first.from)).toBeCloseTo(spring, 6);
  // a circle's segment: at the quarter it has risen more than half way
  const quarter = intradosAt(first, (first.from + mid) / 2) ?? 0;
  expect(quarter - spring).toBeGreaterThan((117.8 - spring) * 0.7);
  expect(intradosAt(first, first.to + 1)).toBeNull();
});

test("masonryBays: DOM1's piers, else Wikidata's spans, else equal bays", () => {
  // the bake's bastions stand as measured
  expect(masonryBays(220, { piers: [100, 50, 160] })).toEqual([
    0, 50, 100, 160, 220,
  ]);
  // ...unless one they leave is wider than an arch can be: a pier DOM1
  // missed (the Reichenbachbrücke's one bastion, 9 m from its end)
  expect(masonryBays(169, { piers: [160.5], span: 44 })).not.toContain(160.5);
  expect(masonryBays(300, { piers: [100, 50] })).toHaveLength(13);
  // the Luitpoldbrücke: one 62.4 m span, the rest is abutment
  const one = masonryBays(80, { spans: 1, span: 62.4 });
  expect(one).toHaveLength(4);
  expect(one[2] - one[1]).toBeCloseTo(62.4, 6);
  // a 44 m main span among three, centred on the fairway
  const three = masonryBays(150, { spans: 3, span: 44, fairway: 0.5 });
  expect(three).toHaveLength(4);
  expect(three[1]).toBeCloseTo(53, 6);
  expect(three[2]).toBeCloseTo(97, 6);
  // only a count: that many equal bays; nothing: about ARCH_SPAN each
  expect(masonryBays(150, { spans: 5 })).toHaveLength(6);
  expect(masonryBays(260)).toHaveLength(11);
  // the Augustusbrücke's 43 m arches get 6 m piers
  const augustus = masonryArches(
    258,
    () => 103,
    () => 111,
    { piers: [43, 86, 129, 172, 215] }
  );
  for (const pier of augustus.piers) {
    expect(2 * pier.half).toBeCloseTo(43 / 7, 6);
  }
  expect(augustus.spans).toHaveLength(6);
});

test("a deck end's approach lands where its ramp meets the ground", () => {
  // the end 1 m above flat ground: at 8 % the ramp lands 12.5 m out
  // (within the flush tolerance a step earlier)
  expect(approachLanding(() => 100, 101, 0.08)).toBe(12);
  // flush (or buried) ends need none
  expect(approachLanding(() => 100.98, 101, 0.08)).toBe(0);
  expect(approachLanding(() => 102, 101, 0.08)).toBe(0);
  // an embankment rising to the deck 4 m out ends it there
  expect(approachLanding((d) => (d >= 4 ? 101 : 99), 101, 0.08)).toBe(4);
  // a deck ending high over a street finds no ground in reach
  expect(approachLanding(() => 90, 101, 0.08)).toBeNull();
  // unknown ground on the way: no approach
  expect(approachLanding((d) => (d > 2 ? null : 100), 101, 0.08)).toBeNull();
});
