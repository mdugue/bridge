import { describe, expect, test } from "bun:test";
import { bakeMode } from "./warmers";

const TILES = ["a", "b", "c", "d", "e"];

describe("bakeMode", () => {
  test("reads a warmer's tiles, and publishes without one", () => {
    expect(bakeMode([], TILES)).toEqual({ kind: "publish" });
    expect(bakeMode(["--warm-ground=a,c"], TILES)).toEqual({
      kind: "ground",
      tiles: ["a", "c"],
    });
    expect(bakeMode(["--warm=e"], TILES)).toEqual({
      kind: "tiles",
      tiles: ["e"],
    });
  });

  test("refuses what it does not know rather than publishing", () => {
    expect(() => bakeMode(["--warm=a,x"], TILES)).toThrow("x");
    expect(() => bakeMode(["--warm=a", "b"], TILES)).toThrow("unknown");
    expect(() => bakeMode(["--warm-grounds=a"], TILES)).toThrow("unknown");
  });
});
