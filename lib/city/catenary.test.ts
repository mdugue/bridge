import { expect, test } from "bun:test";
import {
  CONTACT_MIN_M,
  crossSections,
  MAST_OFFSET_M,
  MAX_SAG_M,
  messengerDrop,
  MIN_SPAN_M,
  type SectionMember,
  sectionPlan,
  STAGGER_M,
  staggerAt,
  staggerSides,
  SUPPORT_GRID_M,
  supportStations,
  underBridge,
  wireStations,
} from "./catenary";

/** A straight track along x from x0 to x1 at z, stations from x0. */
function track(x0: number, x1: number, z = 0) {
  const pts = [
    { x: x0, z },
    { x: x1, z },
  ];
  return { pts, d: [0, x1 - x0] };
}

test("supports stand on the site's grid, wherever a tile cuts the track", () => {
  const whole = track(0, 400);
  const at = supportStations(whole.pts, whole.d).map((s) => s.d);
  expect(at).toEqual([50, 100, 150, 200, 250, 300, 350, 400]);
  // the same track's piece in the next tile: the same x
  const piece = track(230, 400);
  const x = supportStations(piece.pts, piece.d).map((s) => s.d + 230);
  expect(x).toEqual([250, 300, 350, 400]);
});

test("a mapped mast stands in place of the grid's supports near it", () => {
  const t = track(0, 300);
  const s = supportStations(t.pts, t.d, [118]);
  expect(s.map((p) => p.d)).toEqual([50, 118, 150, 200, 250, 300]);
  expect(s.find((p) => p.d === 118)?.key).toBeNull();
  for (let i = 1; i < s.length; i++) {
    expect(s[i].d - s[i - 1].d).toBeGreaterThanOrEqual(MIN_SPAN_M);
  }
});

test("the messenger sags between supports, the contact wire zig-zags", () => {
  const supports = [
    { d: 0, key: "x:0" },
    { d: SUPPORT_GRID_M, key: "x:1" },
    { d: 2 * SUPPORT_GRID_M, key: "x:2" },
  ];
  const stations = wireStations(supports);
  const sides = staggerSides(supports);
  // a virtual station a span beyond each end
  expect(stations).toEqual([-50, 0, 50, 100, 150]);
  expect(messengerDrop(stations, 0)).toBeCloseTo(0);
  expect(messengerDrop(stations, 25)).toBeGreaterThan(0.5);
  expect(messengerDrop(stations, 25)).toBeLessThanOrEqual(MAX_SAG_M);
  const a = staggerAt(stations, sides, 0);
  const b = staggerAt(stations, sides, 50);
  expect(Math.abs(a)).toBeCloseTo(STAGGER_M);
  expect(b).toBeCloseTo(-a);
  expect(staggerAt(stations, sides, 25)).toBeCloseTo(0);
});

test("two tiles drawing one line agree on the contact wire at their seam", () => {
  // the line along x, cut at x 280: one tile has supports to x 250 and a
  // virtual one at 300, the other its supports from x 300
  const zigzag = (x0: number, x1: number, at: number) => {
    const t = track(x0, x1);
    const supports = supportStations(t.pts, t.d);
    return staggerAt(wireStations(supports), staggerSides(supports), at - x0);
  };
  for (const x of [255, 270, 280, 290, 300]) {
    expect(zigzag(0, 280, x)).toBeCloseTo(zigzag(280, 400, x), 6);
  }
  // a mapped mast between supports pulls to the other side from the one
  // before it
  const sides = staggerSides([
    { d: 0, key: "x:2" },
    { d: 30, key: null },
    { d: 50, key: "x:3" },
  ]);
  expect(sides).toEqual([-1, 1, -1, -1, 1]);
});

/** A member on grid line x:2 (x 100) at z, along x. */
const member = (track: number, z: number, h = 5.5): SectionMember => ({
  h,
  track,
  support: 0,
  tx: 1,
  tz: 0,
  x: 100,
  z,
});

test("three tracks side by side share a portal, one alone a mast", () => {
  const groups = crossSections("x:2", [
    member(0, 0),
    member(1, 4.5),
    member(2, 9),
    member(3, 40),
  ]);
  expect(groups.map((g) => g.map((m) => m.track))).toEqual([[0, 1, 2], [3]]);
  const portal = sectionPlan(groups[0]);
  expect(portal.kind).toBe("portal");
  if (portal.kind === "portal") {
    const zs = portal.masts.map((m) => m.z).sort((p, q) => p - q);
    expect(zs[0]).toBeCloseTo(-MAST_OFFSET_M);
    expect(zs[1]).toBeCloseTo(9 + MAST_OFFSET_M);
  }
  const alone = sectionPlan(groups[1]);
  expect(alone.kind).toBe("cantilever");
  expect(alone.kind === "cantilever" && alone.masts.length).toBe(1);
});

test("a track on a viaduct over another is a section of its own", () => {
  const groups = crossSections("x:2", [member(0, 0), member(1, 4, 14)]);
  expect(groups.length).toBe(2);
});

test("under a bridge the wires run on beneath its soffit", () => {
  // the rail head at 110, a road bridge's soffit 6.2 m over it
  const open = underBridge(115.5, 116.9, 110, null);
  expect(open).toEqual({ contact: 115.5, messenger: 116.9 });
  const under = underBridge(115.5, 116.9, 110, 116.2);
  expect(under.messenger).toBeLessThan(116.2);
  expect(under.contact).toBeLessThan(under.messenger);
  expect(under.contact).toBeLessThanOrEqual(115.5);
  // a bridge the data put too low: the wire keeps its least height
  const low = underBridge(115.5, 116.9, 110, 113);
  expect(low.contact).toBeCloseTo(110 + CONTACT_MIN_M);
});
