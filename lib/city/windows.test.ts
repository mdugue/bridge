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
  groundLift,
  NO_DOOR,
  slotDoor,
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
    // the two nearest the middle are kept
    expect(slotDoor(three[2])?.at).toBeCloseTo(0, 9);
    expect(Math.abs(slotDoor(three[3])?.at ?? 0)).toBeCloseTo(4, 9);
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
