import { expect, test } from "bun:test";
import { createRecount } from "./recount";

/** A recount over a value the test moves, with the counts it took. */
function counted() {
  const state = { value: 1, counts: 0 };
  const recount = createRecount(() => {
    state.counts++;
    return state.value;
  });
  return { state, recount };
}

test("the first ask counts; the asks after it do not until something changed", () => {
  const { state, recount } = counted();
  expect(recount.get()).toBe(1);
  state.value = 2;
  expect(recount.get()).toBe(1);
  expect(state.counts).toBe(1);
  recount.changed();
  expect(recount.get()).toBe(2);
  expect(recount.get()).toBe(2);
  expect(state.counts).toBe(2);
});

test("a key that moved counts again without a mark", () => {
  const { state, recount } = counted();
  expect(recount.get(3)).toBe(1);
  state.value = 5;
  expect(recount.get(3)).toBe(1);
  expect(recount.get(4)).toBe(5);
  expect(state.counts).toBe(2);
});

test("a count that throws is taken again at the next ask", () => {
  let fail = true;
  const recount = createRecount(() => {
    if (fail) {
      throw new Error("lost");
    }
    return 7;
  });
  expect(() => recount.get()).toThrow("lost");
  fail = false;
  expect(recount.get()).toBe(7);
});
