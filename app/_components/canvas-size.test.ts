import { expect, test } from "bun:test";

import { canvasSizeFor } from "./canvas-size";

test("a container with area gives its size", () => {
  expect(canvasSizeFor({ clientWidth: 1440, clientHeight: 900 })).toEqual({
    width: 1440,
    height: 900,
  });
});

test("a container without area keeps the last size (null)", () => {
  expect(canvasSizeFor({ clientWidth: 0, clientHeight: 0 })).toBeNull();
  expect(canvasSizeFor({ clientWidth: 1440, clientHeight: 0 })).toBeNull();
  expect(canvasSizeFor({ clientWidth: 0, clientHeight: 900 })).toBeNull();
});
