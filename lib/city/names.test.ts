import { expect, test } from "bun:test";
import { labelPath, nearestName, packAtlas } from "./names";

test("labels shelf-pack into rows of the atlas width", () => {
  const { slots, height } = packAtlas([900, 900, 400, 2100], 56, 2048);
  expect(slots.map((s) => [s.x, s.y])).toEqual([
    [0, 0],
    [900, 0],
    [0, 56],
    [0, 112],
  ]);
  expect(slots[3].w).toBe(2048); // clipped to a row
  expect(height).toBe(168);
  expect(packAtlas([], 56, 2048).height).toBe(0);
});

test("a label is centred on its line and reads west to east", () => {
  const east = labelPath(
    [
      [0, 0],
      [100, 0],
    ],
    40,
    4
  );
  expect(east.pts[0]).toEqual([30, 0]);
  expect(east.pts.at(-1)).toEqual([70, 0]);
  expect(east.s.at(-1)).toBe(40);
  // drawn westward: turned round, so the text still runs left to right
  const west = labelPath(
    [
      [100, 0],
      [0, 0],
    ],
    40,
    4
  );
  expect(west.pts[0]).toEqual([30, 0]);
  // a label longer than its line is squeezed onto it
  const short = labelPath(
    [
      [0, 0],
      [10, 0],
    ],
    40,
    4
  );
  expect(short.pts[0]).toEqual([0, 0]);
  expect(short.pts.at(-1)).toEqual([10, 0]);
});

test("the caption names the nearest street within reach", () => {
  const ways = [
    {
      name: "Hauptstraße",
      line: [
        [0, 0],
        [100, 0],
      ] as [number, number][],
    },
    {
      name: "Königstraße",
      line: [
        [0, 20],
        [100, 20],
      ] as [number, number][],
    },
  ];
  expect(nearestName(ways, 50, 5)).toBe("Hauptstraße");
  expect(nearestName(ways, 50, 15)).toBe("Königstraße");
  expect(nearestName(ways, 50, 60)).toBeNull();
});
