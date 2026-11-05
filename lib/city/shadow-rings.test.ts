import { describe, expect, test } from "bun:test";
import {
  changedTiles,
  modelQuadrants,
  nextRingDue,
  RING_EDGE_FROM,
  RING_EDGE_TO,
  ringAhead,
  ringBias,
  ringDeadZone,
  ringDepth,
  ringFade,
  ringFocus,
  ringTouches,
  SHADOW_RING_HALVES,
  SHADOW_RINGS,
  snapToTexels,
  tileArea,
} from "./shadow-rings";

/** Surface → a sun 17.6° high in the south-south-west. */
const LOW_SUN = (() => {
  const raw = { x: -0.523, y: 0.302, z: 0.797 };
  const len = Math.hypot(raw.x, raw.y, raw.z);
  return { x: raw.x / len, y: raw.y / len, z: raw.z / len };
})();

/** Where `p` lies along the light's axes, as the shadow camera sees it. */
function inLight(p: { x: number; y: number; z: number }) {
  const s = LOW_SUN;
  const len = Math.hypot(s.z, s.x);
  const x = { x: s.z / len, y: 0, z: -s.x / len };
  const y = {
    x: s.y * x.z,
    y: s.z * x.x - s.x * x.z,
    z: -s.y * x.x,
  };
  return {
    x: p.x * x.x + p.z * x.z,
    y: p.x * y.x + p.y * y.y + p.z * y.z,
  };
}

describe("where a ring stands", () => {
  test("on foot no ring leaves the camera, whatever the view does", () => {
    for (const half of SHADOW_RING_HALVES) {
      expect(ringAhead(half, 1.7)).toBe(0);
    }
  });

  test("in the air a ring is pushed along the heading, finest first", () => {
    expect(ringAhead(80, 30)).toBe(40);
    expect(ringAhead(240, 30)).toBeLessThan(120);
    expect(ringAhead(240, 30)).toBeGreaterThan(0);
    expect(ringAhead(2160, 2000)).toBe(1080);
  });

  test("looking straight down the focus is under the camera", () => {
    const view = {
      dirX: 0,
      dirZ: 0,
      eyeX: 10,
      eyeZ: -5,
      groundY: 100,
      height: 200,
    };
    expect(ringFocus(240, view)).toEqual({ x: 10, y: 100, z: -5 });
  });

  test("the focus lies on the ground, never at the camera's height", () => {
    const view = {
      dirX: 0.5,
      dirZ: -0.5,
      eyeX: 0,
      eyeZ: 0,
      groundY: 112,
      height: 300,
    };
    expect(ringFocus(80, view).y).toBe(112);
  });

  test("a ring allows a fifth of its half-size of drift", () => {
    expect(ringDeadZone(80)).toBe(16);
    expect(ringDeadZone(2160)).toBe(432);
  });
});

describe("how much of a ring shows", () => {
  test("all of it near the ground", () => {
    for (let i = 0; i < SHADOW_RINGS; i += 1) {
      expect(ringFade(i, 1.7)).toBe(1);
    }
  });

  test("the finest goes first and smoothly, the widest never", () => {
    expect(ringFade(0, 120)).toBe(1);
    expect(ringFade(0, 160)).toBeCloseTo(0.5, 5);
    expect(ringFade(0, 200)).toBe(0);
    expect(ringFade(1, 200)).toBe(1);
    expect(ringFade(SHADOW_RINGS - 1, 50_000)).toBe(1);
  });

  test("climbing never brings a ring back", () => {
    let last = 1;
    for (let h = 0; h < 2500; h += 7) {
      const now = ringFade(1, h);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });
});

describe("a ring's depth", () => {
  test("a lower sun reaches further along the light", () => {
    const high = ringDepth(80, 0.9);
    const low = ringDepth(80, 0.3);
    expect(low.up).toBeGreaterThan(high.up);
    expect(low.down).toBeGreaterThan(high.down);
  });

  test("it covers a tower standing at the square's far edge", () => {
    // a 300 m tower at the edge toward the sun, under a low sun: its top
    // lies half / tan + 300 / sin from the centre along the light
    const sin = 0.3;
    const { up } = ringDepth(80, sin);
    expect(up).toBeGreaterThan(
      (80 * Math.sqrt(1 - sin * sin)) / sin + 300 / sin
    );
  });

  test("a sun on the horizon stays finite", () => {
    expect(ringDepth(2160, 0).up).toBeLessThanOrEqual(12_000);
    expect(ringDepth(2160, -0.5).down).toBeLessThanOrEqual(12_000);
  });

  test("the bias is about a texel, in depth units", () => {
    const texel = 160 / 2048;
    const bias = ringBias(80, 2048, 1000);
    expect(bias).toBeLessThan(0);
    expect(-bias * 1000).toBeGreaterThan(texel);
    expect(-bias * 1000).toBeLessThan(texel * 1.5);
  });
});

describe("the texel grid", () => {
  test("a snapped point lies on the grid, in light space", () => {
    const texel = 0.078125;
    const p = snapToTexels({ x: 12.34, y: 110, z: -56.78 }, LOW_SUN, texel);
    const { x, y } = inLight(p);
    expect(Math.abs(x / texel - Math.round(x / texel))).toBeLessThan(1e-6);
    expect(Math.abs(y / texel - Math.round(y / texel))).toBeLessThan(1e-6);
  });

  test("it moves a point by less than a texel", () => {
    const texel = 0.5;
    const from = { x: 3.3, y: 90, z: 7.7 };
    const to = snapToTexels(from, LOW_SUN, texel);
    expect(
      Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
    ).toBeLessThan(texel);
  });
});

describe("Modell's quadrants", () => {
  test("they cover the picture's square and overlap in its middle", () => {
    const { half, focus } = modelQuadrants(
      { x: 0, y: 100, z: 0 },
      400,
      LOW_SUN
    );
    expect(focus).toHaveLength(SHADOW_RINGS);
    expect(half).toBeGreaterThan(200);
    for (const f of focus) {
      const { x, y } = inLight(f);
      const c = inLight({ x: 0, y: 100, z: 0 });
      expect(Math.abs(Math.abs(x - c.x) - 200)).toBeLessThan(1e-6);
      expect(Math.abs(Math.abs(y - c.y) - 200)).toBeLessThan(1e-6);
    }
  });
});

/** A tile of 2 km round a point. */
const tile = (x: number, z: number) => ({
  maxX: x + 1000,
  maxZ: z + 1000,
  minX: x - 1000,
  minZ: z - 1000,
});

test("a quadrant's cross-fade lies inside its neighbour's full strength", () => {
  const { half } = modelQuadrants({ x: 0, y: 100, z: 0 }, 400, LOW_SUN);
  // the overlap on the map (0…1), from one quadrant's edge to the other's
  const overlap = (half - 200) / half;
  expect(overlap).toBeGreaterThan(RING_EDGE_TO * 2 + RING_EDGE_FROM * 2);
});

test("a quadrant's depth reaches the picture's far edge", () => {
  const { depthHalf, half } = modelQuadrants(
    { x: 0, y: 100, z: 0 },
    400,
    LOW_SUN
  );
  expect(depthHalf).toBeCloseTo(200 + half, 5);
});

describe("what falls on a ring", () => {
  const centre = { x: 0, y: 100, z: 0 };
  test("a tile under it does", () => {
    expect(ringTouches(centre, 80, tile(0, 0), LOW_SUN)).toBe(true);
  });

  test("a tile far from it does not, and from a wider ring it does", () => {
    const far = tile(4000, -4000);
    expect(ringTouches(centre, 80, far, LOW_SUN)).toBe(false);
    expect(ringTouches(centre, 2160, far, LOW_SUN)).toBe(true);
  });

  test("a tower toward a low sun does, beyond the ring's own ground", () => {
    // toward the sun: its top comes down the light onto the ring
    const toward = {
      maxX: LOW_SUN.x * 1000 + 100,
      maxZ: LOW_SUN.z * 1000 + 100,
      minX: LOW_SUN.x * 1000 - 100,
      minZ: LOW_SUN.z * 1000 - 100,
    };
    expect(ringTouches(centre, 80, toward, LOW_SUN)).toBe(true);
    // the same distance across the light: it cannot
    const across = {
      maxX: LOW_SUN.z * 1000 + 100,
      maxZ: -LOW_SUN.x * 1000 + 100,
      minX: LOW_SUN.z * 1000 - 100,
      minZ: -LOW_SUN.x * 1000 - 100,
    };
    expect(ringTouches(centre, 80, across, LOW_SUN)).toBe(false);
  });
});

test("a tile's bounds come into the scene frame", () => {
  expect(
    tileArea([412_000, 5_656_000, 414_000, 5_658_000], {
      cx: 413_114,
      cy: 5_657_017,
    })
  ).toEqual({ maxX: 886, maxZ: 1017, minX: -1114, minZ: -983 });
});

describe("which tiles changed", () => {
  const a = {};
  const b = {};
  const fine = {};

  test("none when the same parts show", () => {
    const shown = new Map([
      [a, "t1"],
      [b, "t2"],
    ]);
    expect(changedTiles(shown, new Map(shown)).size).toBe(0);
  });

  test("a part landing, leaving or taking over from another", () => {
    const before = new Map([
      [a, "t1"],
      [b, "t2"],
    ]);
    const now = new Map([
      [a, "t1"],
      [fine, "t3"],
    ]);
    expect(changedTiles(before, now)).toEqual(new Set(["t2", "t3"]));
  });
});

describe("which ring draws next", () => {
  const rest = { dirtySince: null, drawnAt: 0 };

  test("none when none is asked for", () => {
    expect(nextRingDue([rest, rest, rest, rest], 1000)).toBe(-1);
  });

  test("the finest of those asked at once", () => {
    const asked = { dirtySince: 5, drawnAt: 0 };
    expect(nextRingDue([asked, asked, asked, asked], 1000)).toBe(0);
  });

  test("the longest waiting, so that none starves", () => {
    const rings = [
      { dirtySince: 900, drawnAt: 0 },
      { dirtySince: 800, drawnAt: 0 },
      { dirtySince: 100, drawnAt: 0 },
      rest,
    ];
    expect(nextRingDue(rings, 1000)).toBe(2);
  });

  test("a wide ring keeps its distance between two redraws", () => {
    const wide = [rest, rest, rest, { dirtySince: 950, drawnAt: 900 }];
    expect(nextRingDue(wide, 1000)).toBe(-1);
    expect(nextRingDue(wide, 1400)).toBe(3);
    const finest = [{ dirtySince: 950, drawnAt: 999 }, rest, rest, rest];
    expect(nextRingDue(finest, 1000)).toBe(0);
  });
});
