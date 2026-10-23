import { expect, test } from "bun:test";
import {
  decodeLift,
  labOf,
  raiseWater,
  rgbOf,
  siteWaterTints,
  WATER_SHEET,
  type WaterBodyRow,
  waterLook,
  waterTint,
} from "./water-bodies";

// 4 × 4: (0, 0) and (3, 3) lifted to the first level, (1, 1) to the second
const LIFT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAAAAACMmsGiAAAAE0lEQVR42mNgZGBgYGBgYkAARgAAQgAFqEacpAAAAABJRU5ErkJggg==";

const body = (over: Partial<WaterBodyRow> = {}): WaterBodyRow => ({
  at: [0, 0],
  level: 2,
  m2: 5000,
  range: [2, 2],
  ...over,
});

test("a lifted cell's ground goes up to its level, never down", async () => {
  const lift = await decodeLift(
    { bodies: [], lifts: { levels: [2, 0.5], m2: 3, png: LIFT_PNG } },
    [0, 0, 4, 4]
  );
  expect(lift?.n).toBe(4);
  const elevations = new Float32Array(16).fill(1);
  elevations[15] = 3; // above its level: stays
  const out = raiseWater({
    elevations,
    n: 4,
    bounds: [0, 0, 4, 4],
    lift: lift ?? {
      bounds: [0, 0, 4, 4],
      index: new Uint8Array(16),
      levels: [],
      n: 4,
    },
  });
  expect(out[0]).toBe(2);
  expect(out[5]).toBe(1); // lifted to 0.5: never lowered
  expect(out[15]).toBe(3);
  expect(out[1]).toBe(1);
  expect(elevations[0]).toBe(1); // a copy
  // a coarser grid by its cells' centres: 2 × 2 over the same tile
  const coarse = raiseWater({
    elevations: new Float32Array(4).fill(0),
    n: 2,
    bounds: [0, 0, 4, 4],
    lift: lift ?? {
      bounds: [0, 0, 4, 4],
      index: new Uint8Array(16),
      levels: [],
      n: 4,
    },
  });
  // centres at 1 and 3 m: lift cells (1, 1) and (3, 3) — rows from the north
  expect(Array.from(coarse)).toEqual([0.5, 0, 0, 2]);
  expect(await decodeLift({ bodies: [] }, [0, 0, 4, 4])).toBeNull();
});

test("Lab goes back to the same sRGB", () => {
  for (const rgb of [WATER_SHEET, 0xa8_98_76, 0x20_1a_14, 0xff_ff_ff]) {
    expect(rgbOf(labOf(rgb))).toBe(rgb);
  }
});

test("water keeps the sheet's colour where it reads its hue or none", () => {
  const sheet = labOf(WATER_SHEET);
  // the palette's hue, darker (a Saxon river): the sheet's colour
  expect(waterTint([40, sheet[1] * 0.8, sheet[2] * 0.8])).toBe(WATER_SHEET);
  // near-black, near-grey water (the Außenalster): no hue to read
  expect(waterTint([6, 0.4, 1.8])).toBe(WATER_SHEET);
  // near-black water with a hue (a Fleet, L* 9): noise, the sheet's colour
  expect(waterTint([9, 4, 1.5])).toBe(WATER_SHEET);
  // ochre (the Hamburg Elbe): its hue at the sheet's lightness
  const ochre = labOf(waterTint([45, 6, 22]));
  expect(ochre[0]).toBeCloseTo(sheet[0], 0);
  expect(Math.atan2(ochre[2], ochre[1])).toBeCloseTo(Math.atan2(22, 6), 1);
  const own = Math.hypot(sheet[1], sheet[2]);
  const c = Math.hypot(ochre[1], ochre[2]);
  expect(c).toBeGreaterThan(own * 0.95);
  expect(c).toBeLessThan(own * 1.35);
});

test("a body is one colour across the tiles it spans", () => {
  // two tiles side by side; the river crosses the seam (west tile's east
  // edge, rows 100–300 = east tile's west edge, rows 150–320)
  const west = {
    id: "w",
    bounds: [0, 0, 2000, 2000] as [number, number, number, number],
    member: {
      bodies: [
        body({ lab: [40, 6, 22], core: 9000, edges: { e: [[100, 300]] } }),
        body({ lab: [40, 0, 0], core: 500 }), // a pond: its own
      ],
    },
  };
  const east = {
    id: "e",
    bounds: [2000, 0, 4000, 2000] as [number, number, number, number],
    member: {
      bodies: [
        body({ lab: [40, 1, 0.5], core: 1000, edges: { w: [[150, 320]] } }),
      ],
    },
  };
  const tints = siteWaterTints([west, east]);
  expect(tints.get("w")?.[0]).toBe(tints.get("e")?.[0]);
  // the pooled read is mostly the west tile's ochre
  expect(tints.get("w")?.[0]).not.toBe(WATER_SHEET);
  expect(tints.get("w")?.[1]).toBe(WATER_SHEET);
  // seams that do not overlap stay apart
  east.member.bodies[0].edges = { w: [[400, 500]] };
  const apart = siteWaterTints([west, east]);
  expect(apart.get("e")?.[0]).toBe(WATER_SHEET);
  // nor do two waters meeting at two heights: a lock on the seam
  west.member.bodies[0].edges = { e: [[100, 300, 2]] };
  east.member.bodies[0].edges = { w: [[150, 320, 0.8]] };
  expect(siteWaterTints([west, east]).get("e")?.[0]).toBe(WATER_SHEET);
  east.member.bodies[0].edges = { w: [[150, 320, 2.3]] };
  expect(siteWaterTints([west, east]).get("e")?.[0]).not.toBe(WATER_SHEET);
});

test("the sheet's look: a tint only where a body differs, foam in the data frame", () => {
  const member = {
    bodies: [body()],
    tint: { n: 64, cells: "AQ==" },
    foam: [
      {
        line: [
          [1010, 2020],
          [1030, 2020],
        ] as [[number, number], [number, number]],
        drop: 2.6,
        down: [0, -1] as [number, number],
      },
    ],
  };
  const offset = { cx: 1000, cy: 2000 };
  expect(waterLook(member, [WATER_SHEET], offset, false)).toBeUndefined();
  const look = waterLook(member, [0xa8_98_76], offset, true);
  expect(look?.tint?.colours).toEqual([0xa8_98_76]);
  expect(look?.foam).toEqual([[10, 20, 30, 20, 2.6, 0, -1]]);
  expect(waterLook(null, [], offset, true)).toBeUndefined();
});
