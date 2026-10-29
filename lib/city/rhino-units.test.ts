import { describe, expect, test } from "bun:test";
import { rhinoUnitMetres } from "./rhino-units";

describe("rhinoUnitMetres", () => {
  test("the units a model is drawn in", () => {
    expect(rhinoUnitMetres(2)).toBe(0.001);
    expect(rhinoUnitMetres(3)).toBe(0.01);
    expect(rhinoUnitMetres(4)).toBe(1);
    expect(rhinoUnitMetres(9)).toBe(0.3048);
  });

  test("none, custom or unknown are metres", () => {
    expect(rhinoUnitMetres(0)).toBe(1);
    expect(rhinoUnitMetres(11)).toBe(1);
    expect(rhinoUnitMetres(null)).toBe(1);
  });
});
