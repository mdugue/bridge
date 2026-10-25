import { describe, expect, test } from "bun:test";
import type { PolygonGeometry } from "./features";
import {
  AxisIndex,
  clearOfTracks,
  DLM_REST_M,
  outsideAreas,
  PLATFORM_EDGE_M,
} from "./platform-clearance";
import type { Point2 } from "./polyline";

/** An axis-aligned box as a platform outline. */
function box(x0: number, y0: number, x1: number, y1: number): PolygonGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  };
}

const track = (y: number, clear: number = PLATFORM_EDGE_M.rail) => ({
  clear,
  coords: [
    [-100, y],
    [100, y],
  ] as Point2[],
});

/** The y extent of a polygon's outer ring. */
function ySpan(g: PolygonGeometry): [number, number] {
  const ys = g.coordinates[0].map((c) => c[1]);
  return [Math.min(...ys), Math.max(...ys)];
}

describe("clearOfTracks", () => {
  test("keeps an outline no track comes near unchanged", () => {
    const g = box(0, 3, 50, 10);
    expect(clearOfTracks(g, new AxisIndex([track(0)]))).toBe(g);
  });

  test("cuts an island platform's edges back to 1.65 m from both tracks", () => {
    // OSM's island 0.6 m from each track's centre, as at Dresden Hbf
    const out = clearOfTracks(
      box(0, 0.6, 80, 7.9),
      new AxisIndex([track(0), track(8.5)])
    ) as PolygonGeometry;
    expect(out.type).toBe("Polygon");
    const [lo, hi] = ySpan(out);
    expect(lo).toBeCloseTo(1.65, 1);
    expect(hi).toBeCloseTo(8.5 - 1.65, 1);
  });

  test("splits a platform a track runs through and drops what is too thin", () => {
    const out = clearOfTracks(
      box(0, -5, 40, 2),
      new AxisIndex([track(0)])
    ) as PolygonGeometry;
    // the strip north of the track is 0.35 m wide: gone; the south part stays
    expect(out.type).toBe("Polygon");
    const [lo, hi] = ySpan(out);
    expect(lo).toBeCloseTo(-5, 5);
    expect(hi).toBeCloseTo(-1.65, 1);
  });

  test("a tram stop keeps the tram's narrower distance", () => {
    const out = clearOfTracks(
      box(0, 0.5, 30, 4),
      new AxisIndex([track(0, PLATFORM_EDGE_M.tram)])
    ) as PolygonGeometry;
    expect(ySpan(out)[0]).toBeCloseTo(1.35, 1);
  });

  test("drops a platform that lies wholly over a track", () => {
    expect(clearOfTracks(box(0, -1, 20, 1), new AxisIndex([track(0)]))).toBe(
      null
    );
  });
});

describe("outsideAreas", () => {
  const island = box(0, -3, 100, 3).coordinates;

  test("leaves a line no area touches alone", () => {
    expect(
      outsideAreas(
        [
          [0, 10],
          [100, 10],
        ],
        [island],
        DLM_REST_M
      )
    ).toBe(null);
  });

  test("drops the stretch of a centreline over an island platform", () => {
    const parts = outsideAreas(
      [
        [-50, 0],
        [150, 0],
      ],
      [island],
      DLM_REST_M
    );
    expect(parts).toEqual([
      [
        [-50, 0],
        [0, 0],
      ],
      [
        [100, 0],
        [150, 0],
      ],
    ]);
  });

  test("drops the rests shorter than a DLM rest", () => {
    const parts = outsideAreas(
      [
        [-10, 0],
        [130, 0],
      ],
      [island],
      DLM_REST_M
    );
    expect(parts).toEqual([
      [
        [100, 0],
        [130, 0],
      ],
    ]);
  });
});
