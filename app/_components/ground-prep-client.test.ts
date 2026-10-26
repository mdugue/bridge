import { expect, test } from "bun:test";
import { type GroundPrepInput, prepareGround } from "@/lib/city/ground-prep";
import { groundWorkerUp, prepareGroundOffThread } from "./ground-prep-client";

/** A 3×3 grid in one buffer that holds more than the positions (as a
 *  glTF accessor's view may), water in every cell. */
function grid(lift = 0): GroundPrepInput {
  const backing = new Float32Array(9 * 3 + 7);
  const positions = backing.subarray(0, 27);
  for (let i = 0; i < 9; i++) {
    positions.set([(i % 3) - 1, i * 0.1 + lift, Math.floor(i / 3) - 1], 3 * i);
  }
  const cells = 4;
  return {
    positions,
    stride: 3,
    offset: 0,
    count: 9,
    normalized: false,
    index: new Uint16Array([0, 3, 1, 1, 3, 4, 4, 5, 1, 4, 7, 5]),
    toData: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1],
    origin: { cx: 0, cy: 0 },
    bounds: [-1, -1, 1, 1] as const,
    grid: 3,
    mask: { cells, water: new Uint8Array(cells * cells).fill(1) },
  };
}

test("the ground worker answers what the main thread would, and leaves the level's own buffers alone", async () => {
  const input = grid();
  const there = await prepareGroundOffThread(input);
  expect(groundWorkerUp()).toBe(true);
  expect(there).toEqual(prepareGround(input));
  expect(input.positions.length).toBe(27);
  expect(input.index?.length).toBe(12);
});

test("a shared index goes once and serves every level that names it", async () => {
  const first = grid();
  const index = first.index as Uint16Array;
  const shared = {};
  await prepareGroundOffThread(first, { shared });
  const second = { ...grid(1), index };
  const there = await prepareGroundOffThread(second, { shared });
  expect(there).toEqual(prepareGround(second));
  expect(there.water?.index.length).toBeGreaterThan(0);
});

test("a job dropped before its turn is never run", async () => {
  const aborter = new AbortController();
  const busy = prepareGroundOffThread(grid());
  const dropped = prepareGroundOffThread(grid(), { signal: aborter.signal });
  aborter.abort();
  await busy;
  let failed = false;
  try {
    await dropped;
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
});

test("a job that cannot be sent is done here, and the queue goes on", async () => {
  // a function cannot be cloned: the message throws before anything goes
  const unsendable = { ...grid(), cannot: () => 0 } as GroundPrepInput;
  const here = await prepareGroundOffThread(unsendable);
  expect(here).toEqual(prepareGround(grid()));
  const after = await prepareGroundOffThread(grid(2));
  expect(after).toEqual(prepareGround(grid(2)));
});

test("a coarse level's job goes ahead of the fine ones queued before it", async () => {
  const order: string[] = [];
  const busy = prepareGroundOffThread(grid());
  const fine = prepareGroundOffThread({ ...grid(1), grid: null }).then(() =>
    order.push("fine")
  );
  const coarse = prepareGroundOffThread(grid(2)).then(() =>
    order.push("coarse")
  );
  await Promise.all([busy, fine, coarse]);
  expect(order).toEqual(["coarse", "fine"]);
});
