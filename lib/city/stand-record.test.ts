import { expect, test } from "bun:test";
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  packStands,
  STAND_RECORD_BYTES,
  STAND_RECORD_WORDS,
  STAND_SCALE_UNIT,
  STAND_STEP_M,
  standAt,
  standCount,
  standMatrix,
  standOrigin,
} from "./stand-record";
import type { Stand } from "./stand-record";

const STANDS: Stand[] = [
  {
    x: -1030.4,
    y: 112.37,
    z: 2040.9,
    turn: 1.234,
    scale: [1.7, 3.2, 1.7],
    kind: [3, 200],
    more: [17, 255],
    spare: 4242,
  },
  { x: 900.02, y: 140, z: 3999.99, turn: -0.5, scale: [0.5, 0.25, 63.9] },
];

test("a record is twenty bytes of ten words, a multiple of four", () => {
  expect(STAND_RECORD_BYTES).toBe(20);
  expect(STAND_RECORD_BYTES % 4).toBe(0);
  const words = packStands(STANDS, standOrigin(STANDS));
  expect(words.length).toBe(STANDS.length * STAND_RECORD_WORDS);
  expect(standCount(words)).toBe(2);
});

test("a stand comes back within half a step, its bytes as written", () => {
  const origin = standOrigin(STANDS);
  const words = packStands(STANDS, origin);
  for (const [i, s] of STANDS.entries()) {
    const back = standAt(words, i, origin);
    expect(Math.abs(back.x - s.x)).toBeLessThanOrEqual(STAND_STEP_M / 2);
    expect(Math.abs(back.y - s.y)).toBeLessThanOrEqual(STAND_STEP_M / 2);
    expect(Math.abs(back.z - s.z)).toBeLessThanOrEqual(STAND_STEP_M / 2);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(back.scale[axis] - s.scale[axis])).toBeLessThanOrEqual(
        0.5 / STAND_SCALE_UNIT
      );
    }
    const turn = ((s.turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    expect(Math.abs(back.turn - turn)).toBeLessThan(1e-4);
  }
  const first = standAt(words, 0, origin);
  expect(first.kind).toEqual([3, 200]);
  expect(first.more).toEqual([17, 255]);
  expect(first.spare).toBe(4242);
});

test("the origin is the corner every stand lies beyond, on whole metres", () => {
  expect(standOrigin(STANDS)).toEqual([-1031, 112, 2040]);
  expect(standOrigin([])).toEqual([0, 0, 0]);
});

test("a full turn is no turn", () => {
  const origin: [number, number, number] = [0, 0, 0];
  const words = packStands(
    [{ x: 0, y: 0, z: 0, turn: Math.PI * 2 - 1e-9, scale: [1, 1, 1] }],
    origin
  );
  expect(standAt(words, 0, origin).turn).toBe(0);
});

test("the composed matrix is three's place · turn about Y · scale", () => {
  const s = STANDS[0];
  const expected = new Matrix4().compose(
    new Vector3(s.x, s.y, s.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), s.turn),
    new Vector3(...s.scale)
  );
  const got = standMatrix(s);
  for (let i = 0; i < 16; i += 1) {
    expect(got[i]).toBeCloseTo(expected.elements[i], 9);
  }
});
