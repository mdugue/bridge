import { describe, expect, test } from "bun:test";
import {
  clearOfDoor,
  DOOR_GAP_M,
  DOOR_NONE_CODE,
  DOOR_SLOT,
  doorClassWidth,
  doorSlot,
  FACADE_ROOF,
  FACADE_SCALE_M,
  type FacadeModel,
  facadeAttribute,
  flatTownHouse,
  NEAR_M,
  slotWallEave,
  WALL_EAVE,
  wallEaveSlot,
  wallRises,
  groundLift,
  LENGTH_MAX_M,
  MEASURED_AXES,
  measuredAxes,
  measuredColumns,
  measuredSlot,
  slotAxes,
  NO_DOOR,
  PALACE_STOREY_M,
  slotDoor,
  packStyle,
  palaceStorey,
  TOWARD_TYPE,
  TYPES,
  unpackStyle,
  WINDOW_LIFT,
  WINDOW_ROWS,
  type WindowHost,
  type WindowWall,
  windowless,
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
  // a flat-roofed town house (G10): the tall type, not the block's
  expect(windowType(true, 20, 3.6, true)).toBe("tall");
});

test("a flat-roofed town house: housing from 9 m, listed or storeys from 3.4 m", () => {
  const house = { eaveH: 14, fn: "31001_1000", listed: false };
  expect(flatTownHouse({ ...house, storeyH: 3.6 })).toBe(true);
  expect(flatTownHouse({ eaveH: 12, listed: true, storeyH: 2.9 })).toBe(true);
  expect(flatTownHouse({ ...house, storeyH: 3 })).toBe(false);
  // a one-storey annex among tall storeys is no town house
  expect(flatTownHouse({ ...house, eaveH: 3.6, storeyH: 3.6 })).toBe(false);
  // an office block or a factory hall is no town house, however tall
  expect(
    flatTownHouse({ ...house, fn: "31001_2020", listed: true, storeyH: 4 })
  ).toBe(false);
  expect(flatTownHouse({ ...house, fn: "31001_3010", storeyH: 4 })).toBe(false);
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
  // no structure has any: a tank, a silo, a crane, a chimney, a mast
  for (const fn of ["51002_1201", "51003_1210", "51006_1400", "53001_1800"]) {
    expect(windowless(fn)).toBe(true);
  }
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
      host({ root: 2, centre: [NEAR_M - 5, 0] }),
      host({ root: 3, centre: [NEAR_M + 30, 0] }),
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

  test("a neighbour lends its rhythm within NEAR_M only (G14)", () => {
    // 60 m off: the next block's, once lent from 150 m, now the type's
    const [, far] = windowSpecs(
      [host(), host({ root: 1, centre: [60, 0] })],
      [measured("a")],
      index
    );
    // the fixture lies past NEAR_M
    expect(60).toBeGreaterThan(NEAR_M);
    expect(far.from).toBe("type");
  });

  test("a frame only on rendered walls, never on brick (G12)", () => {
    const [render, brick] = windowSpecs(
      [
        host({ eaveH: 16, storeyH: 4 }),
        host({ root: 1, centre: [400, 0], eaveH: 16, storeyH: 4, brick: true }),
      ],
      [],
      index
    );
    expect(TYPES.tall.frame).toBe(true);
    expect(unpackStyle(render.spec.style).frame).toBe(true);
    expect(unpackStyle(brick.spec.style).frame).toBe(false);
  });

  test("a flat-roofed town house takes the tall type (G10)", () => {
    const [block, town] = windowSpecs(
      [
        host({ eaveH: 18, storeyH: 3.6, flat: true }),
        host({
          root: 1,
          centre: [400, 0],
          eaveH: 18,
          storeyH: 3.6,
          flat: true,
          town: true,
        }),
      ],
      [],
      index
    );
    expect(block.spec.axis).toBe(TYPES.block.axis);
    expect(town.spec.axis).toBe(TYPES.tall.axis);
    expect(unpackStyle(town.spec.style).frame).toBe(true);
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
    const choices = windowSpecs(hosts, [measured("a")], index);
    for (const choice of choices) {
      expect(choice.from).toBe("none");
      expect(choice.spec.axis).toBe(0);
    }
    // and says why, for the inquiry card
    expect(choices.map((c) => c.why)).toEqual([
      "facade",
      "use",
      "low",
      "beyond",
    ]);
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
    expect(own.storeyFromPhotos).toBe(true);
    const [osm] = windowSpecs(
      [host({ eaveH: 16, levels: true, storeyH: 3.2 })],
      [wall],
      index
    );
    expect(osm.storey).toBeCloseTo(3.2, 9);
    expect(osm.storeyFromPhotos).toBeUndefined();
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

  test("a wall the ground rises too high in front of loses its ground floor alone", () => {
    // 1.6 m in front of one wall would leave the windows squat (above),
    // 1.2 m in front of another not
    const [c] = windowSpecs(
      [host({ eaveH: 9, storeyH: 3, ground: [0.3, 1.2, 1.6] })],
      [],
      index
    );
    const s = unpackStyle(c.spec.style);
    expect(s.noGround).toBe(false);
    expect(c.reach).toBeGreaterThanOrEqual(1.2);
    expect(c.reach).toBeLessThan(1.6);
    expect(s.sill + s.lift - WINDOW_ROWS.plinthGap).toBeCloseTo(
      c.reach ?? 0,
      9
    );
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
    // a plinth too high for the classes, or one the lift would leave the
    // windows wider than tall over: the ground floor stays unlifted, its
    // reach under the plinth (the plinth's walls lose theirs, the bake)
    for (const [c, plinth] of [
      [high, 2.6],
      [squat, 1.6],
    ] as const) {
      const q = unpackStyle(c.spec.style);
      expect(q.noGround).toBe(false);
      expect(q.lift).toBe(0);
      expect(c.reach).toBeLessThan(plinth);
    }
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

  test("a wall whose axes were measured: its windows where the photos saw them", () => {
    const mesh = quads(boxWalls(0, 0, 0, 14, 10, 12));
    const axes = [
      {
        a: [0, 0],
        b: [14, 0],
        n: [0, -1],
        object: 0,
        phase: 1.6,
        axis: 3,
        w: 1.2,
      },
    ] satisfies Parameters<typeof facadeAttribute>[6];
    const f = facadeAttribute(
      mesh,
      () => true,
      [],
      [],
      undefined,
      undefined,
      axes
    );
    // the axes at x = 1.6, 4.6, 7.6, 10.6 fit (0.7 m + half a window in
    // from the ends): their middle, 6.1 m in, is the wall's new middle
    expect(Math.abs(metres(f[0]))).toBeCloseTo(6.1, 1);
    expect(Math.abs(metres(f[4]))).toBeCloseTo(7.9, 1);
    // the length slot holds four columns at the measured 3 m
    expect(slotAxes(f[1])).toEqual({ axis: 3, n: 4 });
    // the east wall measured nothing: centred, its own length
    expect(metres(f[4 * 6 + 1])).toBeCloseTo(10, 1);
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
      // no colour of its own: the object's
      expect([f[4 * 24], f[4 * 24 + 1], f[4 * 24 + 3]]).toEqual([0, 0, 0]);
      // no wall vertex reads as one
      for (let v = 0; v < 24; v++) {
        expect(f[4 * v + 2]).toBe(Math.round(32_767 * NO_DOOR));
      }
    }
  });

  test("a roof vertex carries its face's own colour in its wall slots", () => {
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
    const roofRgb = new Float32Array(3 * 30).fill(Number.NaN);
    roofRgb.set([0.5, 0.25, 0], 3 * 24);
    const f = facadeAttribute({ ...mesh, roofRgb }, () => true);
    expect(f[4 * 24] / 32_767).toBeCloseTo(0.5, 4);
    expect(f[4 * 24 + 1] / 32_767).toBeCloseTo(0.25, 4);
    expect(f[4 * 24 + 2]).toBe(Math.round(32_767 * FACADE_ROOF));
    expect(f[4 * 24 + 3]).toBe(0);
    // the next roof vertex has none: the object's
    expect(f[4 * 25]).toBe(0);
    // a wall vertex keeps its place on the wall
    expect(f[2]).toBe(Math.round(32_767 * NO_DOOR));
  });

  test("a door's place and width on its wall, a shopfront's wall negative", () => {
    const mesh = quads(boxWalls(0, 0, 0, 14, 10, 12));
    const f = facadeAttribute(
      mesh,
      () => true,
      [{ object: 0, at: [10, 0.1], n: [0, -1], w: 1.8 }],
      [{ object: 0, a: [14, 0], b: [14, 10], n: [1, 0] }]
    );
    // the door 3 m from the south wall's middle, the way s runs there
    const door = slotDoor(f[2]);
    expect(Math.abs(door?.at ?? 0)).toBeCloseTo(3, 9);
    expect(door?.w).toBeCloseTo(1.8, 9);
    expect(f[3]).toBe(Math.round(32_767 * NO_DOOR));
    expect(slotDoor(f[3])).toBeUndefined();
    // the south wall keeps its ground floor, the east one stands over a
    // shopfront
    expect(metres(f[1])).toBeCloseTo(14, 1);
    expect(metres(f[4 * 6 + 1])).toBeCloseTo(-10, 1);
  });

  test("a wall with more doors than the slots hold has no ground-floor windows", () => {
    const mesh = quads(boxWalls(0, 0, 0, 14, 10, 12));
    const door = (x: number) => ({
      object: 0,
      at: [x, 0] as [number, number],
      n: [0, -1] as [number, number],
      w: 1.2,
    });
    const two = facadeAttribute(mesh, () => true, [door(3), door(11)]);
    expect(metres(two[1])).toBeCloseTo(14, 1);
    const three = facadeAttribute(mesh, () => true, [
      door(3),
      door(7),
      door(11),
    ]);
    expect(metres(three[1])).toBeCloseTo(-14, 1);
    // its first slot holds the ground in front (not known here: 0), as on
    // a shopfront's wall; the second, with no window to keep off a door,
    // the wall's own eave (the object's here: no door's code)
    expect(metres(three[2])).toBeCloseTo(0, 9);
    expect(three[3]).toBe(Math.round(32_767 * NO_DOOR));
    expect(slotDoor(three[3])).toBeUndefined();
  });
  test("a wall the ground rises past its reach: signed, its ground kept", () => {
    const mesh = quads(boxWalls(0, 0, 0, 14, 10, 12));
    // 4.5 m of ground in front of the east wall (triangles 2 and 3), 1 m
    // in front of the others; the windows clear 2 m
    const at = Array.from({ length: 8 }, (_, t) =>
      t === 2 || t === 3 ? 4.5 : 1
    );
    const f = facadeAttribute(mesh, () => true, [], [], { at, reach: () => 2 });
    expect(metres(f[4 * 6 + 1])).toBeCloseTo(-10, 1);
    expect(metres(f[4 * 6 + 2])).toBeCloseTo(4.5, 1);
    // the south wall keeps its ground floor and its door slot
    expect(metres(f[1])).toBeCloseTo(14, 1);
    expect(f[2]).toBe(Math.round(32_767 * NO_DOOR));
  });
});

describe("a wall's own eave (G22)", () => {
  test("codes over the doors' and under no door, a decimetre a step", () => {
    expect(wallEaveSlot(0)).toBe(Math.round(32_767 * NO_DOOR));
    expect(wallEaveSlot(0.04)).toBe(Math.round(32_767 * NO_DOOR));
    expect(wallEaveSlot(6.2)).toBe(WALL_EAVE.code0 + 62);
    expect(slotWallEave(wallEaveSlot(6.2))).toBeCloseTo(6.2, 9);
    // capped below no door
    expect(wallEaveSlot(999)).toBe(WALL_EAVE.top);
    expect(WALL_EAVE.top).toBeLessThan(32_767);
    // over every door code (#146's at 0.1 m: place·12 + width, ±270 m)
    expect(WALL_EAVE.code0).toBeGreaterThan(2700 * 12 + 11);
    // a door's code and no door read as no eave of its own
    expect(slotWallEave(12_000)).toBe(0);
    expect(slotWallEave(32_767)).toBe(0);
  });

  test("each wall carries its eave over the object's in its second slot", () => {
    // a block 12 m high whose north half rises to 18 m: the wall to the
    // north stands 6 m over the object's eave (its lowest roof)
    const walls = boxWalls(0, 0, 0, 14, 10, 12);
    walls[2] = {
      object: 0,
      pts: [
        [14, 10, 0],
        [0, 10, 0],
        [0, 10, 18],
        [14, 10, 18],
      ],
    };
    const mesh = quads(walls);
    const heights = { of: () => ({ base: 0, eave: 12 }) };
    const f = facadeAttribute(mesh, () => true, [], [], undefined, heights);
    // the south wall stands at the object's eave: none of its own
    expect(f[3]).toBe(Math.round(32_767 * NO_DOOR));
    // the north wall (vertices 12–17), 6 m over
    expect(slotWallEave(f[4 * 12 + 3])).toBeCloseTo(6, 1);
    // without heights, as before
    const plain = facadeAttribute(mesh, () => true);
    expect(plain[4 * 12 + 3]).toBe(Math.round(32_767 * NO_DOOR));
  });

  test("a low house's party wall is blank only up to its neighbour's top (G16)", () => {
    // a 9 m house against a 4 m one: its wall above the neighbour is a
    // facade again; against an 8 m one too little is left: blank
    for (const [nb, open] of [
      [4, true],
      [8, false],
    ] as const) {
      const mesh = quads([
        ...boxWalls(0, 0, 0, 10, 10, 9),
        ...boxWalls(1, 10, 0, 20, 10, nb),
      ]);
      const heights = {
        of: (o: number) => ({ base: 0, eave: o === 0 ? 9 : nb }),
      };
      const f = facadeAttribute(mesh, () => true, [], [], undefined, heights);
      // object 0's east wall (x = 10)
      const length = metres(f[4 * 6 + 1]);
      if (open) {
        // negative: no window under the height in its first door slot
        expect(length).toBeCloseTo(-10, 1);
        expect(metres(f[4 * 6 + 2])).toBeCloseTo(nb, 1);
      } else {
        expect(f[4 * 6 + 1]).toBe(0);
      }
    }
    // a taller house's party wall stays blank, whatever is beside it
    const mesh = quads([
      ...boxWalls(0, 0, 0, 10, 10, 15),
      ...boxWalls(1, 10, 0, 20, 10, 4),
    ]);
    const f = facadeAttribute(mesh, () => true, [], [], undefined, {
      of: (o: number) => ({ base: 0, eave: o === 0 ? 15 : 4 }),
    });
    expect(f[4 * 6 + 1]).toBe(0);
  });
});

describe("the door slots", () => {
  test("hold a door's place to a decimetre and its width rounded up", () => {
    for (const at of [-12.34, -0.05, 0, 3.0, 7.96, 120.5]) {
      for (const w of [0.6, 1.2, 1.25, 1.8, 2.0, 2.24, 2.6, 4, 5.5, 6]) {
        const door = slotDoor(doorSlot(at, w));
        expect(Math.abs((door?.at ?? Number.NaN) - at)).toBeLessThanOrEqual(
          DOOR_SLOT.step / 2 + 1e-9
        );
        expect(door?.w ?? 0).toBeGreaterThanOrEqual(w - 1e-9);
        // 0.2 m classes to 2 m, whole metres from there
        const grain = w <= 2 + 1e-9 ? DOOR_SLOT.wStep : DOOR_SLOT.wideStep;
        expect(door?.w ?? 0).toBeLessThan(w + grain);
      }
    }
    expect(slotDoor(doorSlot(0, 2.6))?.w).toBeCloseTo(3, 9);
    expect(slotDoor(doorSlot(0, 6))?.w).toBeCloseTo(6, 9);
    // a door wider than the widest class, or far along, is held
    expect(slotDoor(doorSlot(0, 9))?.w).toBeCloseTo(6, 9);
    expect(slotDoor(doorSlot(400, 1.2))?.at).toBeCloseTo(DOOR_SLOT.reach, 9);
  });

  test("the width classes rise without a gap and end at 6 m", () => {
    for (let c = 1; c < DOOR_SLOT.widths; c++) {
      expect(doorClassWidth(c)).toBeGreaterThan(doorClassWidth(c - 1));
      expect(doorSlot(0, doorClassWidth(c))).toBe(c);
    }
    expect(doorClassWidth(0)).toBeCloseTo(DOOR_SLOT.w0, 9);
    expect(doorClassWidth(DOOR_SLOT.widths - 1)).toBeCloseTo(6, 9);
  });

  test("never read as the roof's flag or as no door", () => {
    const codes = [
      doorSlot(-1e4, 9),
      doorSlot(-1e4, 0),
      doorSlot(1e4, 9),
      doorSlot(1e4, 0),
    ];
    for (const code of codes) {
      expect(Math.abs(code)).toBeLessThan(DOOR_NONE_CODE);
      // the clay's roof flag: a first door slot at FACADE_ROOF + 1e-3 or less
      expect(code / 32_767).toBeGreaterThan(FACADE_ROOF + 1e-3);
      expect(slotDoor(code)).toBeDefined();
    }
    expect(slotDoor(Math.round(32_767 * FACADE_ROOF))).toBeUndefined();
  });

  test("a ground-floor window keeps the gap from a door's opening", () => {
    const door = { at: 0, w: 1.2 };
    const w = 1.1;
    // the gap, and half a place step for the door's rounded place
    const edge = door.w / 2 + DOOR_GAP_M + DOOR_SLOT.step / 2 + w / 2;
    expect(clearOfDoor(edge, w, door)).toBe(true);
    expect(clearOfDoor(-edge, w, door)).toBe(true);
    expect(clearOfDoor(edge - 0.01, w, door)).toBe(false);
    // a wide gate keeps its windows further off
    expect(clearOfDoor(edge, w, { at: 0, w: 2.6 })).toBe(false);
  });

  test("a window clear of a slot's door keeps the gap from the door itself", () => {
    const w = 1.1;
    for (const at of [-7.04, -0.05, 0.049, 3.33, 11.96]) {
      for (const dw of [0.9, 1.25, 2.24, 3.5]) {
        const held = slotDoor(doorSlot(at, dw));
        if (held === undefined) {
          throw new Error("a door's slot reads as no door");
        }
        for (let axis = at - 6; axis <= at + 6; axis += 0.01) {
          if (clearOfDoor(axis, w, held)) {
            expect(Math.abs(axis - at)).toBeGreaterThanOrEqual(
              dw / 2 + DOOR_GAP_M + w / 2 - 1e-9
            );
          }
        }
      }
    }
  });
});

describe("wallRises", () => {
  test("the ground in front of a wall, also of one standing on a step", () => {
    // a south wall from the base and one standing 6 m up, both facing a
    // terrace 7 m over the base; a roof reads nothing
    const mesh = quads([
      {
        object: 0,
        pts: [
          [0, 0, 0],
          [10, 0, 0],
          [10, 0, 5],
          [0, 0, 5],
        ],
      },
      {
        object: 1,
        pts: [
          [20, 0, 6],
          [30, 0, 6],
          [30, 0, 12],
          [20, 0, 12],
        ],
      },
      {
        object: 1,
        roof: true,
        pts: [
          [20, 0, 12],
          [30, 0, 12],
          [30, 10, 12],
          [20, 10, 12],
        ],
      },
    ]);
    const rises = wallRises(
      mesh,
      () => 0,
      (_x, y) => (y < 0 ? 7 : 0)
    );
    expect(Array.from(rises.slice(0, 4))).toEqual([7, 7, 7, 7]);
    expect(Number.isNaN(rises[4])).toBe(true);
    // level ground: the wall on the step stands over a lower roof, its
    // reading does not count
    const flat = wallRises(
      mesh,
      () => 0,
      () => 0
    );
    expect(Array.from(flat.slice(0, 2))).toEqual([0, 0]);
    expect(Number.isNaN(flat[2])).toBe(true);
  });
});

describe("palaces", () => {
  const index = new Map([["a", 0]]);

  test("a palace's storey: OSM's count where it is a storey, else ~5.5 m", () => {
    expect(palaceStorey(18, 3)).toBeCloseTo(6, 9);
    expect(palaceStorey(18, 1)).toBeCloseTo(18 / 3, 9); // 18 m: not a storey
    expect(palaceStorey(16.5)).toBeCloseTo(PALACE_STOREY_M, 9);
    expect(palaceStorey(4)).toBeCloseTo(4, 9);
  });

  test("an own facade carries windows only as a palace, of its type", () => {
    const [blank, palace] = windowSpecs(
      [
        host({ ownFacade: true, eaveH: 18 }),
        host({ ownFacade: true, eaveH: 18, palace: true, storeys: 3 }),
      ],
      [],
      index
    );
    expect(blank.from).toBe("none");
    expect(palace.from).toBe("type");
    expect(palace.storey).toBeCloseTo(6, 9);
    expect(palace.spec.h).toBeGreaterThan(2.5);
    expect(palace.spec.axis).toBeCloseTo(TYPES.palace.axis, 1);
  });

  test("a palace never borrows a town house's rhythm nearby", () => {
    const [, palace] = windowSpecs(
      [
        host({ centre: [10, 0] }),
        host({ eaveH: 18, ownFacade: true, palace: true, root: 1 }),
      ],
      [measured("a")],
      index
    );
    expect(palace.from).toBe("type");
  });
});

describe("measured axes", () => {
  test("the lattice's axes that fit, counted exactly", () => {
    const m = measuredColumns(0, 14, { at: 1.6, axis: 3, w: 1.2 });
    expect(m?.c).toBeCloseTo(6.1, 6);
    expect(m?.n).toBe(4);
    // any axis of the lattice says the same
    expect(
      measuredColumns(0, 14, { at: 13.6, axis: 3, w: 1.2 })?.c
    ).toBeCloseTo(6.1, 6);
    // none fits on a wall shorter than a window and its edges
    expect(measuredColumns(0, 2, { at: 1, axis: 3, w: 1.2 })).toBeUndefined();
  });

  test("the length slot holds the count and the spacing", () => {
    const units = measuredSlot(7, 3.88);
    expect(units).toBeGreaterThanOrEqual(MEASURED_AXES.base);
    expect(units).toBeLessThan(32_767);
    const got = slotAxes(-units);
    expect(got?.n).toBe(7);
    expect(got?.axis).toBeCloseTo(3.88, 6);
    // the longest length the slot holds stays a length
    expect(
      slotAxes(Math.round((LENGTH_MAX_M / FACADE_SCALE_M) * 32_767))
    ).toBeUndefined();
    // the most axes at the widest spacing still fit in snorm16
    const top =
      MEASURED_AXES.axis0 + (MEASURED_AXES.perN - 1) * MEASURED_AXES.step;
    expect(measuredSlot(MEASURED_AXES.maxN, top)).toBeLessThanOrEqual(32_767);
  });

  test("each wall keeps its own measured spacing", () => {
    const wall = (axis: number): WindowWall =>
      ({
        a: [100, 200],
        b: [114, 200],
        eave: 12,
        imgs: 6,
        L: 14,
        model: { axis, grid: "regular", h: 1.5, phase: 1.6, w: 1.2 },
        n: [0, -1],
        oid: "A",
      }) as WindowWall;
    const index = new Map([["A", 0]]);
    const spec = { axis: 2.3, h: 1.5, style: 0, w: 1.2 };
    const got = measuredAxes([wall(3.88)], index, () => spec, {
      cx: 100,
      cy: 200,
    });
    expect(got).toEqual([
      {
        a: [0, 0],
        axis: 3.88,
        b: [14, 0],
        n: [0, -1],
        object: 0,
        phase: 1.6,
        w: 1.2,
      },
    ]);
    // a window never wider than its measured spacing leaves room for
    expect(
      measuredAxes([wall(1.5)], index, () => spec, { cx: 100, cy: 200 })[0]?.w
    ).toBeCloseTo(1.5 - WINDOW_ROWS.gap, 6);
    // a spacing outside what the slot holds: nothing
    expect(
      measuredAxes([wall(7)], index, () => spec, { cx: 100, cy: 200 })
    ).toEqual([]);
    // no phase measured, or no windows drawn: nothing
    const plain = {
      ...wall(3),
      model: { axis: 3, grid: "regular", h: 1.5, w: 1.2 },
    } as WindowWall;
    expect(
      measuredAxes([plain], index, () => spec, { cx: 100, cy: 200 })
    ).toEqual([]);
    expect(
      measuredAxes([wall(3)], index, () => undefined, { cx: 100, cy: 200 })
    ).toEqual([]);
  });
});
