import { expect, test } from "bun:test";
import { type Compiling, compileInLanes } from "./compile-lanes";

interface Item {
  id: string;
  material: string;
}

/** Steps that run until the test ends them, noting each start. */
function heldSteps() {
  const started: string[] = [];
  const ends = new Map<
    string,
    { finish: () => void; fail: (e: Error) => void }
  >();
  const step = (item: Item) =>
    new Promise<void>((resolve, reject) => {
      started.push(item.id);
      ends.set(item.id, { finish: resolve, fail: reject });
    });
  const end = (id: string) => ends.get(id)?.finish();
  const fail = (id: string, error: Error) => ends.get(id)?.fail(error);
  return { started, step, end, fail };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Whether `promise` has settled by now, and how. */
function watch(promise: Promise<unknown>) {
  const state = { settled: false, error: undefined as unknown };
  promise.then(
    () => {
      state.settled = true;
    },
    (err: unknown) => {
      state.settled = true;
      state.error = err;
    }
  );
  return state;
}

test("a walk over drawables another walk is compiling resolves only once their steps have, its own lanes going on meanwhile", async () => {
  const done = new WeakMap<Item, Compiling>();
  const { started, step, end } = heldSteps();
  const a = { id: "a", material: "m" };
  const b = { id: "b", material: "m" };
  const c = { id: "c", material: "m" };
  // a tile's own compile, in one lane
  const tile = watch(compileInLanes([a, b], step, done, { lanes: 1 }));
  await settle();
  // the boot's compile of the whole scene: a is the tile's, so it takes b
  // and c
  const boot = watch(compileInLanes([a, b, c], step, done, { lanes: 2 }));
  await settle();
  expect(started).toEqual(["a", "b", "c"]);
  end("a");
  await settle();
  // the tile's lane met b, which the boot is compiling: not uploaded yet
  expect(tile.settled).toBe(false);
  end("c");
  await settle();
  expect(boot.settled).toBe(false);
  end("b");
  await settle();
  expect(tile).toEqual({ settled: true, error: undefined });
  expect(boot).toEqual({ settled: true, error: undefined });
  // each compiled once; a walk over them now resolves without a step
  await compileInLanes([a, b, c], step, done, { lanes: 4 });
  expect(started).toEqual(["a", "b", "c"]);
  // ...until a drawable wears another material
  b.material = "n";
  const again = watch(compileInLanes([a, b], step, done, { lanes: 4 }));
  await settle();
  expect(started).toEqual(["a", "b", "c", "b"]);
  end("b");
  await settle();
  expect(again.settled).toBe(true);
});

test("a step that failed fails every walk that waits for it: none of them uploaded that drawable", async () => {
  const done = new WeakMap<Item, Compiling>();
  const { step, fail } = heldSteps();
  const a = { id: "a", material: "m" };
  const first = watch(compileInLanes([a], step, done, { lanes: 4 }));
  await settle();
  const second = watch(compileInLanes([a], step, done, { lanes: 4 }));
  const lost = new RangeError("Allocation failure.");
  fail("a", lost);
  await settle();
  expect(first).toEqual({ settled: true, error: lost });
  expect(second).toEqual({ settled: true, error: lost });
});

test("a drawable left out (its tile left) gets no step", async () => {
  const done = new WeakMap<Item, Compiling>();
  const ran: string[] = [];
  await compileInLanes(
    [
      { id: "kept", material: "m" },
      { id: "gone", material: "m" },
    ],
    (item) => {
      ran.push(item.id);
      return Promise.resolve();
    },
    done,
    { lanes: 4, skip: (item) => item.id === "gone" }
  );
  expect(ran).toEqual(["kept"]);
});
