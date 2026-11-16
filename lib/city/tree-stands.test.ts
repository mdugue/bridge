/**
 * The trees' stand records (tree-stands.ts): the fast path every canopy
 * tree takes (`placementRecords`) writes what the one-record path
 * (`placementStand`, `writeStand`) writes.
 */
import { expect, test } from "bun:test";
import { STAND_RECORD_WORDS, STAND_WORD, writeStand } from "./stand-record";
import type { Placement } from "./tree-placement";
import { placementRecords, placementStand } from "./tree-stands";

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
