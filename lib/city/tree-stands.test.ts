/**
 * The trees' stand records (tree-stands.ts): the fast path every canopy
 * tree takes (`placementRecords`) writes what the one-record path
 * (`placementStand`, `writeStand`) writes.
 */
import { expect, test } from "bun:test";
import { STAND_RECORD_WORDS, STAND_WORD, writeStand } from "./stand-record";
import type { Placement } from "./tree-placement";
import {
  crownFrame,
  placementRecords,
  placementStand,
  registerTrunkStand,
} from "./tree-stands";
import {
  REGISTER_WORDS,
  registerAt,
  registerTree,
  writeRegister,
} from "./tree-table";

const tree: Placement = {
  base: 4,
  rot: 1.25,
  s: 1.4,
  w: 1.1,
  x: 12.5,
  y: 103.25,
  z: -40.75,
  // unlike along x and z, so a swap of the two bytes shows
  slope: [40, -24],
};

test("a tree's slope lies in the more word, x in its low byte, z in its high", () => {
  const { words } = placementRecords([tree]);
  const more = words[STAND_WORD.more];
  expect([more & 0xff, more >> 8]).toEqual([128 + 40, 128 - 24]);
});

test("the table of many is the records of each, word for word", () => {
  const other: Placement = { ...tree, x: 30, z: -8, slope: [-56, 8], rot: 4 };
  for (const widen of [1, 1.35]) {
    const { origin, words } = placementRecords([tree, other], widen);
    const one = new Uint16Array(2 * STAND_RECORD_WORDS);
    writeStand(one, 0, placementStand(tree, widen), origin);
    writeStand(one, 1, placementStand(other, widen), origin);
    expect([...words]).toEqual([...one]);
  }
});

test("the table's origin is under the lowest crown, not the lowest foot", () => {
  // a crown starts where its base lifts it to: the heights' sixteen bits
  // are spent from there
  const { lift } = crownFrame(tree);
  expect(lift).toBeGreaterThan(1);
  const { origin } = placementRecords([tree]);
  expect(origin[1]).toBe(Math.floor(tree.y + lift));
  expect(origin[1]).toBeGreaterThan(Math.floor(tree.y));
});

test("a surveyed tree's own trunk carries the slope at its foot", () => {
  const origin = [412_000, 5_656_000, 104] as const;
  const words = new Uint16Array(REGISTER_WORDS);
  writeRegister(
    words,
    0,
    {
      e: 412_000.7,
      n: 5_657_966.2,
      ground: 118.42,
      index: 3,
      slope: [0.5, -0.25],
      props: { a: 0, d: 4.5, h: 15.5, l: "d" },
    },
    origin,
    { clamped: 0 }
  );
  const trunk = registerTrunkStand(
    registerTree(
      registerAt(words, 0, origin),
      { cx: 411_000, cy: 5_657_000 },
      2026
    )
  );
  // steps of eight of 127, x then z, round 128
  expect(trunk.more).toEqual([128 + 64, 128 - 32]);
});
