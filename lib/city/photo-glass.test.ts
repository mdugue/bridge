import { describe, expect, test } from "bun:test";
import {
  inheritedFlags,
  inheritedLook,
  objectFlags,
  OBJECT_FLAG_GLASS,
} from "./city-mesh";
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

  test("a short glass wall read alone needs a quarter of the outer walls", () => {
    const walls = [wall("tower", 8, true), wall("pavilion", 8, true)];
    const got = photoGlassObjects(walls, { tower: 60, pavilion: 24 });
    expect([...got]).toEqual(["pavilion"]);
    // 15 m reads as glass on a hall, not on a mall 30 times its glass
    const front = [wall("hall", 16, true), wall("mall", 16, true)];
    const big = photoGlassObjects(front, { hall: 300, mall: 547 });
    expect([...big]).toEqual(["hall"]);
  });

  test("the photos give glass only where no source names a material", () => {
    const lut = withPhotoGlass(
      { b: { material: "brick" }, C: { material: "stone" } },
      {
        buildings: {
          A: [wall("a", 20, true)],
          B: [wall("b", 20, true)],
          C: [wall("c", 20, true)],
        },
      }
    );
    expect(lut?.a).toEqual({ material: "glass", materialFrom: "photos" });
    expect(lut?.b).toEqual({ material: "brick" });
    expect(lut?.c).toBeUndefined();
    expect(objectFlags(lut?.a) & OBJECT_FLAG_GLASS).toBe(OBJECT_FLAG_GLASS);
  });

  test("a Building with parts keeps its glass to itself", () => {
    const lut = withPhotoGlass(
      {},
      {
        buildings: {
          B: [wall("B", 30, true), wall("p", 20, false), wall("q", 20, true)],
        },
      }
    );
    expect(lut?.B?.materialFrom).toBe("photos");
    // a part the photos read as stone takes none of it, one read as glass
    // is glass on its own
    expect(inheritedLook(lut?.p, lut?.B).material).toBeUndefined();
    expect(inheritedFlags(lut?.p, lut?.B) & OBJECT_FLAG_GLASS).toBe(0);
    expect(inheritedLook(lut?.q, lut?.B).materialFrom).toBe("photos");
  });

  test("a material named on the root keeps its parts from the photos", () => {
    const lut = withPhotoGlass(
      { B: { material: "stone" } },
      { buildings: { B: [wall("B", 30, true), wall("q", 20, true)] } }
    );
    expect(lut?.q).toBeUndefined();
    expect(inheritedLook(lut?.q, lut?.B).material).toBe("stone");
  });

  test("without the outer walls' length, a glass front needs its metres", () => {
    expect(photoGlassObjects([wall("a", 10, true)])).toEqual(new Set());
    expect(photoGlassObjects([wall("a", 20, true)])).toEqual(new Set(["a"]));
  });

  test("a tile the photos found no glass on keeps its table", () => {
    const lut = { a: { levels: 3 } };
    expect(
      withPhotoGlass(lut, { buildings: { a: [wall("a", 20, false)] } })
    ).toBe(lut);
  });
});
