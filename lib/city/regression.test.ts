import { expect, test } from "bun:test";
import {
  createRegressionState,
  RECOVER_MS,
  stepRegression,
} from "./regression";

test("a fresh state is not regressed", () => {
  expect(createRegressionState()).toEqual({ regressed: false, stillMs: 0 });
});

test("regresses on the very first moving frame", () => {
  const state = createRegressionState();
  expect(stepRegression(state, true, 16)).toBe(true);
  expect(state.regressed).toBe(true);
});

test("does not recover before the recover window elapses", () => {
  const state = createRegressionState();
  stepRegression(state, true, 16);
  let regressed = true;
  for (let ms = 0; ms + 16 < RECOVER_MS; ms += 16) {
    regressed = stepRegression(state, false, 16);
    expect(regressed).toBe(true);
  }
  expect(regressed).toBe(true);
});

test("recovers exactly at the recover window and stays recovered", () => {
  const state = createRegressionState();
  stepRegression(state, true, 16);
  expect(stepRegression(state, false, RECOVER_MS - 1)).toBe(true);
  expect(stepRegression(state, false, 1)).toBe(false);
  expect(stepRegression(state, false, 1000)).toBe(false);
});

test("a single still frame mid-movement does not recover", () => {
  const state = createRegressionState();
  stepRegression(state, true, 16);
  expect(stepRegression(state, false, 16)).toBe(true);
  expect(stepRegression(state, true, 16)).toBe(true);
  expect(state.stillMs).toBe(0);
});

test("moving again re-arms the full recover window", () => {
  const state = createRegressionState();
  stepRegression(state, true, 16);
  stepRegression(state, false, RECOVER_MS - 10);
  stepRegression(state, true, 16);
  expect(stepRegression(state, false, RECOVER_MS - 10)).toBe(true);
});

test("a zero (or negative) dt is harmless", () => {
  const state = createRegressionState();
  stepRegression(state, true, 0);
  expect(stepRegression(state, false, 0)).toBe(true);
  expect(stepRegression(state, false, -100)).toBe(true);
  expect(state.stillMs).toBe(0);
  expect(stepRegression(state, false, RECOVER_MS)).toBe(false);
});

test("a custom recover window overrides the default", () => {
  const state = createRegressionState();
  stepRegression(state, true, 16);
  expect(stepRegression(state, false, 40, 50)).toBe(true);
  expect(stepRegression(state, false, 10, 50)).toBe(false);
});
