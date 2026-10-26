import { expect, test } from "bun:test";
import { prepareGround } from "@/lib/city/ground-prep";
import { prepareGroundOffThread } from "./ground-prep-client";

test("the ground worker answers what the main thread would, and leaves the level's own buffers alone", async () => {
  // a 3×3 grid in one buffer that holds more than the positions (as a
  // glTF accessor's view may)
  const backing = new Float32Array(9 * 3 + 7);
  const positions = backing.subarray(0, 27);
  for (let i = 0; i < 9; i++) {
    positions.set([(i % 3) - 1, i * 0.1, Math.floor(i / 3) - 1], 3 * i);
  }
  const index = new Uint16Array([0, 3, 1, 1, 3, 4, 4, 5, 1, 4, 7, 5]);
  const cells = 4;
  const water = new Uint8Array(cells * cells).fill(1);
  const input = {
    positions,
    stride: 3,
    offset: 0,
    count: 9,
    normalized: false,
    index,
    toData: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1],
    origin: { cx: 0, cy: 0 },
    bounds: [-1, -1, 1, 1] as const,
    grid: 3,
    mask: { cells, water },
  };
  const there = await prepareGroundOffThread(input);
  const here = prepareGround(input);
  expect(there).toEqual(here);
  expect(positions.length).toBe(27);
  expect(index.length).toBe(12);
});
