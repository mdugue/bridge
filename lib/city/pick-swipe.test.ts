import { expect, test } from "bun:test";
import { deckBehind, stepped, swipeStep } from "./pick-swipe";

test("a pull far enough or a flick fast enough leafs on, a nudge springs back", () => {
  expect(swipeStep(-120, 0)).toBe(1);
  expect(swipeStep(120, 0)).toBe(-1);
  expect(swipeStep(-20, -900)).toBe(1);
  expect(swipeStep(20, 900)).toBe(-1);
  expect(swipeStep(30, 100)).toBe(0);
});

test("the deck goes round, the next card first behind the open one", () => {
  expect(stepped(4, 1, 5)).toBe(0);
  expect(stepped(0, -1, 5)).toBe(4);
  expect(stepped(0, 1, 0)).toBe(0);
  expect(deckBehind(3, 5)).toEqual([4, 0, 1, 2]);
  expect(deckBehind(0, 1)).toEqual([]);
});
