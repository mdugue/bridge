import { expect, test } from "bun:test";
import { METHOD_ORDER, METHODS, methodOfToken } from "./methods";

test("a docs badge token names its method in either language, nothing else does", () => {
  expect(methodOfToken("◎ erkannt")).toBe("detected");
  expect(methodOfToken("≈ assumed")).toBe("assumed");
  expect(methodOfToken(" ❝ übernommen ")).toBe("taken");
  // the word alone is ordinary code, not a badge
  expect(methodOfToken("erkannt")).toBeNull();
  expect(methodOfToken("= x")).toBeNull();
});

test("the deterministic methods come first, the inferred last", () => {
  expect(METHOD_ORDER.map((m) => METHODS[m].inferred)).toEqual([
    false,
    false,
    true,
    true,
  ]);
});
