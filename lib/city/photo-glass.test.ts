import { describe, expect, test } from "bun:test";
import { objectFlags, OBJECT_FLAG_GLASS } from "./city-mesh";
import { photoGlassObjects, withPhotoGlass } from "./photo-glass";
import type { WindowWall } from "./windows-file";

function wall(oid: string, L: number, glass?: boolean): WindowWall {
  return {
    a: [0, 0],
    b: [L, 0],
    eave: 12,
    imgs: 0,
    L,
    n: [0, -1],
    oid,
    seqs: 0,
    traits: {},
    wi: 0,
    ...(glass === undefined
      ? {}
      : { glass: { glass, n: 3, p: glass ? 960 : 120 } }),
  };
}

describe("glass fronts from the street photos", () => {
  test("an object is glass when most of its walls read for glass are", () => {
    const got = photoGlassObjects([
      wall("hall", 40, true),
      wall("hall", 20, false),
      wall("house", 30, false),
      wall("house", 8, true),
      wall("unread", 50),
    ]);
    expect([...got]).toEqual(["hall"]);
  });

  test("the photos give glass only where no source names a material", () => {
    const walls = [
      wall("a", 20, true),
      wall("b", 20, true),
      wall("c", 20, true),
    ];
    const roots: Record<string, string> = { a: "A", b: "B", c: "C" };
    const lut = withPhotoGlass(
      { b: { material: "brick" }, C: { material: "stone" } },
      walls,
      (id) => roots[id]
    );
    expect(lut?.a).toEqual({ material: "glass", materialFrom: "photos" });
    expect(lut?.b).toEqual({ material: "brick" });
    expect(lut?.c).toBeUndefined();
    expect(objectFlags(lut?.a) & OBJECT_FLAG_GLASS).toBe(OBJECT_FLAG_GLASS);
  });

  test("a tile the photos found no glass on keeps its table", () => {
    const lut = { a: { levels: 3 } };
    expect(withPhotoGlass(lut, [wall("a", 20, false)], () => {})).toBe(lut);
  });
});
