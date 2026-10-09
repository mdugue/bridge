import { describe, expect, test } from "bun:test";
import {
  FACADE_ROOF,
  FACADE_SCALE_M,
  type FacadeModel,
  facadeAttribute,
  groundLift,
  NO_DOOR,
  packStyle,
  TOWARD_TYPE,
  TYPES,
  unpackStyle,
  WINDOW_LIFT,
  WINDOW_ROWS,
  type WindowHost,
  type WindowWall,
  windowAxes,
  windowless,
  windowRows,
  windowSpecs,
  windowStorey,
  windowType,
} from "./windows";

const model = (extra: Partial<FacadeModel> = {}): FacadeModel => ({
  axis: 3,
  grid: "regular",
  h: 1.6,
  w: 1.2,
  ...extra,
});

const host = (extra: Partial<WindowHost> = {}): WindowHost => ({
  centre: [0, 0],
  eaveH: 15,
  flat: false,
  levels: false,
  lod2: true,
  ownFacade: false,
  root: 0,
  shop: false,
  storeyH: 3.75,
  ...extra,
});

const measured = (oid: string, m = model()): WindowWall => ({
  a: [0, 0],
  b: [14, 0],
  eave: 15,
  imgs: 4,
  L: 14,
  model: m,
  n: [0, -1],
  oid,
  seqs: 2,
  traits: {},
  wi: 0,
});

describe("the style", () => {
  test("packs and unpacks its bits, depth and sill to their class", () => {
    const style = packStyle({
      loose: true,
      lintel: true,
      noGround: true,
      depth: 0.18,
      sill: 0.85,
      lift: 0.6,
    });
    // exact in a float texel
    expect(packStyle({ lift: 9, depth: 9, sill: 9, frame: true })).toBeLessThan(
      2 ** 24
    );
    const s = unpackStyle(style);
    expect(s).toMatchObject({
      loose: true,
      frame: false,
      lintel: true,
      noGround: true,
      measured: false,
      near: false,
    });
    expect(s.depth).toBeCloseTo(0.18, 9);
    expect(s.sill).toBeCloseTo(0.85, 9);
    expect(s.lift).toBeCloseTo(0.6, 9);
  });

  test("clamps depth and sill into their classes", () => {
    const s = unpackStyle(packStyle({ depth: 2, sill: 0 }));
    expect(s.depth).toBeCloseTo(0.27, 9);
    expect(s.sill).toBeCloseTo(0.5, 9);
  });
});

test("a building's type: roof, eave, storey", () => {
  expect(windowType(true, 20, 3)).toBe("block");
  expect(windowType(true, 5, 3)).toBe("low");
  expect(windowType(false, 5, 2.5)).toBe("house");
  expect(windowType(false, 16, 4)).toBe("tall");
  expect(windowType(false, 12, 3)).toBe("storey");
});

test("the storey snaps to a whole number under the eave", () => {
  expect(windowStorey(16, 3.14)).toBeCloseTo(3.2, 9);
  // the photos' storey wins over the estimate
  expect(windowStorey(16, 3.14, 4.1)).toBeCloseTo(4, 9);
  // nothing to snap on a low wall
  expect(windowStorey(2.5, 3)).toBe(3);
});

test("garages, sheds and plants have no windows", () => {
  expect(windowless("31001_2463")).toBe(true);
  expect(windowless("31001_2522")).toBe(true);
  expect(windowless("31001_2723")).toBe(true);
  expect(windowless("31001_1000")).toBe(false);
  expect(windowless(undefined)).toBe(false);
});

describe("windowSpecs", () => {
  const index = new Map([
    ["a", 0],
    ["b", 1],
    ["c", 2],
    ["d", 3],
  ]);

  test("its own walls first, then its building's, a neighbour's, its type", () => {
    const hosts = [
      host({ root: 0 }),
      host({ root: 0, centre: [5, 0] }),
      host({ root: 2, centre: [60, 0] }),
      host({ root: 3, centre: [400, 0] }),
    ];
    const [a, b, c, d] = windowSpecs(
      hosts,
      [measured("a", model({ axis: 3.4, grid: "loose", orn: true }))],
      index
    );
    expect(a.from).toBe("measured");
    // drawn towards its type's, not past the photos'
    const t = TYPES[windowType(false, 15, a.storey)];
    expect(a.spec.axis).toBeGreaterThan(t.axis);
    expect(a.spec.axis).toBeLessThan(3.4);
    expect(unpackStyle(a.spec.style)).toMatchObject({
      loose: true,
      lintel: true,
      measured: true,
    });
    expect(b.from).toBe("tree");
    expect(b.spec.axis).toBe(a.spec.axis);
    expect(c.from).toBe("near");
    expect(c.spec.axis).toBe(a.spec.axis);
    expect(unpackStyle(c.spec.style).near).toBe(true);
    // beyond NEAR_M: the type's rhythm
    expect(d.from).toBe("type");
    expect(d.spec.axis).toBe(TYPES[windowType(false, 15, d.storey)].axis);
  });

  test("a neighbour lends only to its own roof form and about its eave", () => {
    const hosts = [
      host(),
      host({ root: 1, centre: [20, 0], flat: true }),
      host({ root: 2, centre: [20, 0], eaveH: 30 }),
    ];
    const [, flat, tall] = windowSpecs(hosts, [measured("a")], index);
    expect(flat.from).toBe("type");
    expect(tall.from).toBe("type");
  });

  test("none on a facade of its own, a garage, a low wall or a shed", () => {
    const hosts = [
      host({ ownFacade: true }),
      host({ root: 1, fn: "31001_2463" }),
      host({ root: 2, eaveH: 2.8 }),
      host({ root: 3, lod2: false }),
    ];
    for (const choice of windowSpecs(hosts, [measured("a")], index)) {
      expect(choice.from).toBe("none");
      expect(choice.spec.axis).toBe(0);
    }
  });

  test("the window keeps its lintel under the next storey line", () => {
    const [low] = windowSpecs(
      [host({ eaveH: 9, storeyH: 3 })],
      [measured("a", model({ h: 2.4 }))],
      index
    );
    const { sill } = unpackStyle(low.spec.style);
    expect(low.spec.h).toBeCloseTo(low.storey - sill - WINDOW_ROWS.lintel, 2);
  });

  test("the photos' storey only where OSM counts none", () => {
    const wall = measured("a", model({ storey: 4.1 }));
    const [own] = windowSpecs([host({ eaveH: 16 })], [wall], index);
    expect(own.storey).toBeCloseTo(4, 9);
    const [osm] = windowSpecs(
      [host({ eaveH: 16, levels: true, storeyH: 3.2 })],
      [wall],
      index
    );
    expect(osm.storey).toBeCloseTo(3.2, 9);
  });

  test("a shop's ground floor gets none", () => {
    const [shop] = windowSpecs([host({ shop: true })], [], index);
    expect(unpackStyle(shop.spec.style).noGround).toBe(true);
  });

  test("a measured rhythm keeps near its type's", () => {
    const [wide, narrow] = windowSpecs(
      [host(), host({ root: 1, centre: [400, 0] })],
      [
        measured("a", model({ axis: 4.6, w: 2.2, h: 2.4 })),
        measured("b", model({ axis: 1.9, w: 0.75, h: 1 })),
      ],
      index
    );
    for (const [c, side] of [
      [wide, "hi"],
      [narrow, "lo"],
    ] as const) {
      const t = TYPES[windowType(false, 15, c.storey)];
      expect(c.from).toBe("measured");
      expect(c.spec.w / t.w).toBeCloseTo(TOWARD_TYPE.w[side], 1);
      // to the centimetre
      expect(c.spec.axis).toBeGreaterThanOrEqual(
        t.axis * TOWARD_TYPE.axis.lo - 0.005
      );
      expect(c.spec.axis).toBeLessThanOrEqual(
        t.axis * TOWARD_TYPE.axis.hi + 0.005
      );
    }
  });

  test("the ground floor's windows keep over the plinth", () => {
    const [low, high, raised, squat] = windowSpecs(
      [
        host({ eaveH: 9, storeyH: 3, plinth: 1.2 }),
        host({ root: 1, eaveH: 9, storeyH: 3, plinth: 2.6 }),
        host({ root: 2, eaveH: 16, storeyH: 4 }),
        host({ root: 3, eaveH: 9, storeyH: 3, plinth: 1.6 }),
      ],
      [],
      index
    );
    const s = unpackStyle(low.spec.style);
    expect(s.sill + s.lift).toBeGreaterThanOrEqual(
      1.2 + WINDOW_ROWS.plinthGap - 1e-9
    );
    expect(s.noGround).toBe(false);
    // a plinth too high for the classes: no ground-floor windows
    expect(unpackStyle(high.spec.style).noGround).toBe(true);
    // ...nor where the lift would leave them wider than tall
    const q = unpackStyle(squat.spec.style);
    expect(squat.spec.h - q.lift).toBeLessThan(
      WINDOW_ROWS.squat * squat.spec.w
    );
    expect(q.noGround).toBe(true);
    // a town house's Hochparterre
    expect(unpackStyle(raised.spec.style).lift).toBeCloseTo(
      WINDOW_ROWS.raise,
      9
    );
  });
});

test("the ground floor's lift: a Hochparterre, over the plinth, in classes", () => {
  expect(groundLift(false, 0.9)).toBe(0);
  expect(groundLift(true, 0.9)).toBeCloseTo(WINDOW_ROWS.raise, 9);
  // 0.9 m of plinth and its gap over a 0.9 m sill
  expect(groundLift(false, 0.9, 0.9)).toBeCloseTo(WINDOW_ROWS.plinthGap, 9);
  // rounded up to a class
  expect(groundLift(false, 0.9, 0.92)).toBeCloseTo(
    WINDOW_ROWS.plinthGap + WINDOW_LIFT.step,
    9
  );
  expect(groundLift(true, 0.85, 0.9)).toBeCloseTo(WINDOW_ROWS.raise, 9);
  expect(groundLift(false, 0.85, 3)).toBeUndefined();
  expect(WINDOW_ROWS.raise / WINDOW_LIFT.step).toBeCloseTo(
    Math.round(WINDOW_ROWS.raise / WINDOW_LIFT.step),
    9
  );
});

describe("the layout", () => {
  const spec = { axis: 3, w: 1.2, h: 1.6, style: packStyle({ sill: 0.9 }) };

  test("the axes are centred, the outer ones off the wall's ends", () => {
    const xs = windowAxes(14, spec);
    expect(xs.length).toBe(4);
    expect(xs[0] + xs.at(-1)!).toBeCloseTo(0, 9);
    expect(xs[1] - xs[0]).toBeCloseTo(3, 9);
    expect(7 + xs[0] - spec.w / 2).toBeGreaterThanOrEqual(
      WINDOW_ROWS.edge - 1e-9
    );
    expect(windowAxes(2, spec)).toEqual([]);
  });

  test("a row per storey from the ground floor, under the eave", () => {
    const rows = windowRows(spec, 3.5, 15);
    expect(rows[0][0]).toBeCloseTo(0.9, 9);
    expect(rows[1][0]).toBeCloseTo(3.5 + 0.9, 9);
    for (const [z0, z1] of rows) {
      expect(z1 - z0).toBeCloseTo(1.6, 9);
      expect(z1).toBeLessThanOrEqual(15 - WINDOW_ROWS.eaveClear + 1e-9);
    }
    expect(rows.length).toBe(4);
    // no ground floor over a shop
    expect(windowRows(spec, 3.5, 15, false)[0][0]).toBeCloseTo(4.4, 9);
  });

  test("a top floor's windows end under the eave, shorter if they must", () => {
    const clipped = windowRows(spec, 3.5, 13.3).at(-1)!;
    expect(clipped[0]).toBeCloseTo(11.4, 9);
    expect(clipped[1]).toBeCloseTo(13.3 - WINDOW_ROWS.eaveClear, 9);
    // too little left: none
    expect(windowRows(spec, 3.5, 12.3).at(-1)![0]).toBeCloseTo(7.9, 9);
  });

  test("a lifted ground floor keeps its head", () => {
    const lifted = { ...spec, style: packStyle({ sill: 0.9, lift: 0.45 }) };
    const [ground, first] = windowRows(lifted, 3.5, 15);
    expect(ground[0]).toBeCloseTo(0.9 + 0.45, 9);
    expect(ground[1]).toBeCloseTo(0.9 + 1.6, 9);
    expect(first[0]).toBeCloseTo(3.5 + 0.9, 9);
  });
});

/** Quads as triangles (a b c, a c d), per object. */
function quads(list: { object: number; pts: number[][]; roof?: boolean }[]): {
  isRoof: number[];
  objectIds: number[];
  positions: number[];
} {
  const out = {
    isRoof: [] as number[],
    objectIds: [] as number[],
    positions: [] as number[],
  };
  for (const { object, pts, roof } of list) {
    const [a, b, c, d] = pts;
    for (const p of [a, b, c, a, c, d]) {
      out.positions.push(...p);
      out.objectIds.push(object);
      out.isRoof.push(roof ? 1 : 0);
    }
  }
  return out;
}

/** A box's four walls, outward, from (x0, y0) to (x1, y1), 0 → h. */
function boxWalls(
  object: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  h: number
) {
  return [
    // south, facing −y: counter-clockwise seen from outside
    {
      object,
      pts: [
        [x0, y0, 0],
        [x1, y0, 0],
        [x1, y0, h],
        [x0, y0, h],
      ],
    },
    {
      object,
      pts: [
        [x1, y0, 0],
        [x1, y1, 0],
        [x1, y1, h],
        [x1, y0, h],
      ],
    },
    {
      object,
      pts: [
        [x1, y1, 0],
        [x0, y1, 0],
        [x0, y1, h],
        [x1, y1, h],
      ],
    },
    {
      object,
      pts: [
        [x0, y1, 0],
        [x0, y0, 0],
        [x0, y0, h],
        [x0, y1, h],
      ],
    },
  ];
}

const metres = (v: number) => (v / 32_767) * FACADE_SCALE_M;

describe("facadeAttribute", () => {
  test("every wall vertex: its place from the wall's middle and the wall's length", () => {
    const mesh = quads([
      ...boxWalls(0, 0, 0, 14, 10, 12),
      {
        object: 0,
        roof: true,
        pts: [
          [0, 0, 12],
          [14, 0, 12],
          [14, 10, 12],
          [0, 10, 12],
        ],
      },
    ]);
    const f = facadeAttribute(mesh, () => true);
    // the south wall's first vertex (0, 0): 7 m from its middle
    expect(Math.abs(metres(f[0]))).toBeCloseTo(7, 1);
    expect(metres(f[1])).toBeCloseTo(14, 1);
    expect(f[2]).toBe(Math.round(32_767 * NO_DOOR));
    // the east wall is 10 m long
    expect(metres(f[4 * 6 + 1])).toBeCloseTo(10, 1);
    // the roof carries none
    expect(f[4 * 24 + 1]).toBe(0);
    // along the wall s runs one way: its two ends are opposite
    expect(metres(f[0])).toBeCloseTo(-metres(f[4 * 1]), 1);
  });

  test("a party wall gets none; the other walls keep theirs", () => {
    const mesh = quads([
      ...boxWalls(0, 0, 0, 10, 10, 12),
      ...boxWalls(1, 10, 0, 20, 10, 12),
    ]);
    const f = facadeAttribute(mesh, () => true);
    // object 0's east wall (x = 10) stands against object 1's west wall
    expect(f[4 * 6 + 1]).toBe(0);
    expect(f[4 * 24 + 3 * 6 * 4 + 1]).toBe(0);
    // their south walls keep their length
    expect(metres(f[1])).toBeCloseTo(10, 1);
    expect(metres(f[4 * 24 + 1])).toBeCloseTo(10, 1);
  });

  test("objects without windows are left out", () => {
    const mesh = quads(boxWalls(0, 0, 0, 10, 10, 12));
    const f = facadeAttribute(mesh, () => false);
    expect(f[1]).toBe(0);
    expect(f[2]).toBe(Math.round(32_767 * NO_DOOR));
  });

  test("a roof vertex carries the roof flag in its first door slot, windows or not", () => {
    const mesh = quads([
      ...boxWalls(0, 0, 0, 14, 10, 12),
      {
        object: 0,
        roof: true,
        pts: [
          [0, 0, 12],
          [14, 0, 12],
          [14, 10, 12],
          [0, 10, 12],
        ],
      },
    ]);
    for (const drawn of [true, false]) {
      const f = facadeAttribute(mesh, () => drawn);
      expect(f[4 * 24 + 2]).toBe(Math.round(32_767 * FACADE_ROOF));
      expect(f[4 * 24 + 3]).toBe(Math.round(32_767 * NO_DOOR));
      // no wall vertex reads as one
      for (let v = 0; v < 24; v++) {
        expect(f[4 * v + 2]).toBe(Math.round(32_767 * NO_DOOR));
      }
    }
  });

  test("a door's place on its wall, a shopfront's wall negative", () => {
    const mesh = quads(boxWalls(0, 0, 0, 14, 10, 12));
    const f = facadeAttribute(
      mesh,
      () => true,
      [{ object: 0, at: [10, 0.1], n: [0, -1] }],
      [{ object: 0, a: [14, 0], b: [14, 10], n: [1, 0] }]
    );
    // the door 3 m from the south wall's middle, the way s runs there
    expect(Math.abs(metres(f[2]))).toBeCloseTo(3, 1);
    expect(f[3]).toBe(Math.round(32_767 * NO_DOOR));
    // the east wall stands over a shopfront
    expect(metres(f[4 * 6 + 1])).toBeCloseTo(-10, 1);
  });
});
