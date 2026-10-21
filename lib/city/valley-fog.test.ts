import { expect, test } from "bun:test";
import {
  groundRelief,
  VALLEY_FALLOFF_MAX,
  VALLEY_FALLOFF_MIN,
  type ValleyRim,
  valleyDepth,
  valleyFalloff,
} from "./valley-fog";

test("the relief is the river and the typical high ground, not the extremes", () => {
  const heights = [
    -40,
    ...Array.from({ length: 98 }, (_, i) => 100 + i * 0.5),
    900,
  ];
  const [low, high] = groundRelief(heights);
  expect(low).toBeCloseTo(100.5, 5);
  expect(high).toBeCloseTo(144.5, 5);
});

test("a valley keeps the tuned pool, a flat site gets a shallow one", () => {
  // Dresden: the Elbe at 105 m, the Heide's slopes at 195 m
  expect(valleyFalloff([105, 195])).toBe(VALLEY_FALLOFF_MAX);
  // Hamburg: the harbour at 2 m, the Geest at 18 m
  expect(valleyFalloff([2, 18])).toBeCloseTo(9.6, 5);
  expect(valleyFalloff([500, 501])).toBe(VALLEY_FALLOFF_MIN);
  expect(valleyFalloff(undefined)).toBe(VALLEY_FALLOFF_MAX);
});

/** A tile's valley of 16 azimuths, clockwise from north, its floor at
 *  `floorM`: `north` on the northern half (west to east-north-east),
 *  `south` on the rest. */
function rim(floorM: number, north: number, south: number): ValleyRim {
  return {
    floorM,
    rimM: Array.from({ length: 16 }, (_, k) =>
      k <= 3 || k >= 12 ? north : south
    ),
  };
}

test("a valley is as deep as its lower side rises above the floor", () => {
  // the Elbe at 105 m between a 230 m and a 250 m rim: the lower, 125 m
  expect(valleyDepth([rim(105, 230, 250)])).toBe(125);
  // a one-sided slope: the land falls away to the north, climbs south
  expect(valleyDepth([rim(70, 66, 190)])).toBe(0);
  // the deepest axis wins: east and west rise too
  const ridges = rim(70, 80, 80);
  const rimM = ridges.rimM.map((h, k) => (k === 4 || k === 12 ? 160 : h));
  expect(valleyDepth([{ ...ridges, rimM }])).toBe(90);
});

test("each tile is read from its own low ground; the deepest counts", () => {
  // a tile on the hillside: the slope beside it stands above the site's
  // floor along the slope too, but not above the tile's own low ground
  const foot = rim(70, 72, 190);
  const hillside = rim(110, 112, 230);
  expect(valleyDepth([foot, hillside])).toBe(2);
  // a tile in the river's valley among them
  expect(valleyDepth([foot, rim(60, 140, 150)])).toBe(80);
  // an unknown side counts as no rise
  const open = rim(100, 200, 200);
  const rimM = open.rimM.map((h, k) => (k === 8 ? null : h));
  expect(valleyDepth([{ ...open, rimM }])).toBe(100);
});

test("without rims the site's relief stands in", () => {
  expect(valleyDepth([])).toBeUndefined();
  expect(valleyDepth([{ floorM: 100, rimM: [] }])).toBeUndefined();
  const heights = Array.from({ length: 100 }, (_, i) => 100 + i);
  expect(groundRelief(heights)).toEqual([102, 190]);
  expect(groundRelief(heights, [rim(102, 130, 300)])).toEqual([102, 190, 28]);
});

test("the pool fills a share of the valley's depth, not of the relief", () => {
  // Unna: 50 m of slope inside the site, but no valley: the shallowest pool
  expect(valleyFalloff([70, 120, 2])).toBe(VALLEY_FALLOFF_MIN);
  // a valley deeper than its own tiles show: Dresden's rim beyond them
  expect(valleyFalloff([105, 128, 125])).toBe(VALLEY_FALLOFF_MAX);
  expect(valleyFalloff([105, 128, 30])).toBeCloseTo(18, 5);
});
